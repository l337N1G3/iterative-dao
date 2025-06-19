import BN from 'bn.js';
import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';

import { IterativeDao } from '../target/types/iterative_dao';

describe("Exit Escrow Tests (Test Case 10)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: anchor.web3.Keypair;
  let user: anchor.web3.Keypair;
  let governorPda: anchor.web3.PublicKey;
  let governorBump: number;
  let governanceMint: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;
  let escrowTokenAccount: anchor.web3.PublicKey;
  let lockIdCounter: number;
  const connection = provider.connection;

  beforeEach(async () => {
    lockIdCounter = 0;
    smartWallet = anchor.web3.Keypair.generate();
    user = anchor.web3.Keypair.generate();
    [governorPda, governorBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("governor"), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    try {
      governanceMint = await createMint(
        connection,
        provider.wallet.payer,
        user.publicKey, // mint authority
        null,           // freeze authority
        0               // decimals
      );
      console.log("Governance mint created:", governanceMint.toBase58());
      const userTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        governanceMint,
        user.publicKey
      );
      userTokenAccount = userTokenAcc.address;
      console.log("User token account:", userTokenAccount.toBase58());
      const escrowTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        governanceMint,
        smartWallet.publicKey
      );
      escrowTokenAccount = escrowTokenAcc.address;
      console.log("Escrow token account:", escrowTokenAccount.toBase58());
      await mintTo(
        connection,
        provider.wallet.payer,
        governanceMint,
        userTokenAccount,
        user, // mint authority
        1000 // mint 1000 tokens
      );
      console.log("Minted 1000 tokens to user token account.");
    } catch (error) {
      console.error("Error setting up token accounts:", error);
      throw error;
    }
    try {
      await program.methods
        .initGovernor(
          new BN(60),    // vote_threshold
          new BN(3600),  // timelock_delay (1 hour)
          user.publicKey, // electorate
          governanceMint  // governance_mint
        )
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("Governor initialised successfully.");
    } catch (error) {
      console.error("Error initialising governor:", error);
      throw error;
    }
    try {
      await program.methods
        .addVoter(user.publicKey, new BN(100)) // weight of 100
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("User added as recognised voter with weight 100.");
    } catch (error) {
      console.error("Error adding voter:", error);
      throw error;
    }
    try {
      const governorAccount = await program.account.governor.fetch(governorPda);
      const voter = governorAccount.voters.find(
        v => v.pubkey.toBase58() === user.publicKey.toBase58()
      );
      assert.isNotNull(voter, "User should be recognised as a voter");
      console.log("User recognised with weight:", voter.weight.toString());
    } catch (error) {
      console.error("Error verifying voter:", error);
      throw error;
    }
  });
  async function deriveLockAccountPda(
    governorPk: anchor.web3.PublicKey,
    userPk: anchor.web3.PublicKey,
    lockId: BN
  ): Promise<PublicKey> {
    const [pda] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("lock"),
        governorPk.toBuffer(),
        userPk.toBuffer(),
        lockId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    return pda;
  }

  it("Test Case 10.1: Exit escrow post lock period via multi-sig and verify token transfer", async () => {
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
      // lock 100 tokens for 5 seconds
      const amount = new BN(100);
      const duration = new BN(5);
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log(`Locked ${amount} tokens for ${duration}s.`);
      await new Promise(res => setTimeout(res, duration.toNumber() * 1000 + 1000));
      const beforeBal = await getAccount(connection, userTokenAccount);
      console.log("User tokens before withdrawal:", beforeBal.amount.toString());
      const txSig = await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log("WithdrawTokens TX #10.1:", txSig);
      const afterBal = await getAccount(connection, userTokenAccount);
      console.log("User tokens after withdrawal:", afterBal.amount.toString());

      // started with 1000, locked 100 so 900 accessible. On withdraw, back to 1000
      assert.equal(afterBal.amount.toString(), "1000");
      // check escrow is empty
      const escrowBal = await getAccount(connection, escrowTokenAccount);
      assert.equal(escrowBal.amount.toString(), "0", "Escrow should be empty after withdrawal.");
      // LockAccount must be marked withdrawn
      const la = await program.account.lockAccount.fetch(lockPda);
      assert.isTrue(la.withdrawn, "LockAccount should be withdrawn");
    } catch (error: any) {
      console.error("Error in Test Case 10.1:", error);
      assert.fail(`Test Case 10.1 failed: ${error.message}`);
    }
  });

  it("Test Case 10.2: Attempt to exit escrow before lock period ends through multi-sig and expect failure", async () => {
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
      const amount = new BN(50);
      const duration = new BN(1000); // 1000 seconds
      // Lock tokens
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log(`Locked ${amount} tokens for ${duration}s.`);
      await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();
      assert.fail("Withdrawal should have failed before the lock expired.");
    } catch (err: any) {
      console.log("Test Case 10.2 caught error:", err);
      if (err.error?.errorCode?.code) {
        assert.equal(err.error.errorCode.code, "LockNotExpired");
      } else {
        assert.include(err.toString(), "LockNotExpired");
      }
      console.log("Test Case 10.2 passed (failed as expected).");
    }
  });

  it("Test Case 10.4: Attempt exit by unauthorised member via multi-sig and expect failure", async () => {
    try {
      const attacker = anchor.web3.Keypair.generate();
      const attackerTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        governanceMint,
        attacker.publicKey
      );
      const attackerTokenAccount = attackerTokenAcc.address;
      await mintTo(
        connection,
        provider.wallet.payer,
        governanceMint,
        attackerTokenAccount,
        user, // user is the mint authority
        100
      );
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockPda = await deriveLockAccountPda(governorPda, attacker.publicKey, lockId);
      const amount = new BN(10);
      const duration = new BN(5);
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: attacker.publicKey,
          userTokenAccount: attackerTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, attacker])
        .rpc();
      console.log(`Locked ${amount} tokens by attacker for ${duration}s`);
      // wait for lock to expire
      await new Promise(res => setTimeout(res, duration.toNumber() * 1000 + 1000));
      // Attempt to withdraw
      await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: attacker.publicKey,
          userTokenAccount: attackerTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, attacker])
        .rpc();
      assert.fail("Withdrawal should have failed for unauthorised member.");
    } catch (err: any) {
      console.log("Caught error in 10.4:", err);
      if (err.error?.errorCode?.code) {
        assert.equal(err.error.errorCode.code, "UnauthorisedVoter");
      } else {
        assert.include(err.toString(), "UnauthorisedVoter");
      }
      console.log("Test Case 10.4 passed (failed as expected).");
    }
  });

  it("Test Case 10.5: Validate escrow and locker records are updated upon exit through consensus", async () => {
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
      const amount = new BN(60);
      const duration = new BN(5);
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log(`Locked ${amount} tokens for ${duration}s.`);
      await new Promise(res => setTimeout(res, duration.toNumber() * 1000 + 1000));
      const txSig = await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log("WithdrawTokens TX #10.5:", txSig);
      const la = await program.account.lockAccount.fetch(lockPda);
      assert.isTrue(la.withdrawn, "LockAccount should be marked withdrawn");
      const escrowBal = await getAccount(connection, escrowTokenAccount);
      assert.equal(escrowBal.amount.toString(), "0");
    } catch (error: any) {
      console.error("Error in Test Case 10.5:", error);
      assert.fail(`Test Case 10.5 failed: ${error.message}`);
    }
  });

  it("Test Case 10.6: Ensure locked supply decreases appropriately through multi-sig approvals", async () => {
    try {
      const lockAmounts = [new BN(20), new BN(30), new BN(50)];
      const durations = [new BN(5), new BN(5), new BN(5)];
      const lockPdas: PublicKey[] = [];
      for (let i = 0; i < lockAmounts.length; i++) {
        lockIdCounter += 1;
        const lockId = new BN(lockIdCounter);
        const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
        lockPdas.push(lockPda);
        await program.methods
          .lockTokens(lockAmounts[i], durations[i], lockId)
          .accounts({
            governor: governorPda,
            smartWallet: smartWallet.publicKey,
            user: user.publicKey,
            userTokenAccount: userTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            lockAccount: lockPda,
            payer: provider.wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([smartWallet, user])
          .rpc();

        console.log(`Locked ${lockAmounts[i]} tokens for ${durations[i]}s.`);
      }

      // wait for all
      await new Promise(res => setTimeout(res, 6000)); // 5s + 1 buffer

      // now withdraw each
      for (let i = 0; i < lockPdas.length; i++) {
        const txSig = await program.methods
          .withdrawTokens(new BN(lockIdCounter - lockPdas.length + 1 + i))
          .accounts({
            lockAccount: lockPdas[i],
            user: user.publicKey,
            userTokenAccount: userTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            smartWallet: smartWallet.publicKey,
            governor: governorPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([smartWallet, user])
          .rpc();
        console.log(`WithdrawTokens TX #10.6.${i + 1}:`, txSig);
      }
      // check user balance should be back to 1000
      const userBal = await getAccount(connection, userTokenAccount);
      assert.equal(userBal.amount.toString(), "1000", "User should have 1000 tokens again");
      // escrow now empty
      const escrowBal = await getAccount(connection, escrowTokenAccount);
      assert.equal(escrowBal.amount.toString(), "0");
    } catch (error: any) {
      console.error("Error in Test Case 10.6:", error);
      assert.fail(`Test Case 10.6 failed: ${error.message}`);
    }
  });

  it("Test Case 10.7: Attempt to exit already exited escrow via multi-sig and expect failure", async () => {
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);

      const amount = new BN(40);
      const duration = new BN(5);
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      await new Promise(res => setTimeout(res, duration.toNumber() * 1000 + 1000));
      await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();
      console.log("First withdrawal success.");
      await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();
      assert.fail("Second withdrawal should fail with AlreadyWithdrawn");
    } catch (err: any) {
      console.log("Test Case 10.7 caught error:", err);
      if (err.error?.errorCode?.code) {
        assert.equal(err.error.errorCode.code, "AlreadyWithdrawn");
      } else {
        assert.include(err.toString(), "AlreadyWithdrawn");
      }
      console.log("Test Case 10.7 passed (failed as expected).");
    }
  });

  it("Test Case 10.8: Handle multiple exits through multi-sig and ensure system consistency", async () => {
    try {
      const lockAmounts = [new BN(25), new BN(35), new BN(40)];
      const durations = [new BN(5), new BN(5), new BN(5)];
      const lockPdas: PublicKey[] = [];
      for (let i = 0; i < lockAmounts.length; i++) {
        lockIdCounter += 1;
        const lockId = new BN(lockIdCounter);
        const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
        lockPdas.push(lockPda);
        await program.methods
          .lockTokens(lockAmounts[i], durations[i], lockId)
          .accounts({
            governor: governorPda,
            smartWallet: smartWallet.publicKey,
            user: user.publicKey,
            userTokenAccount: userTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            lockAccount: lockPda,
            payer: provider.wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([smartWallet, user])
          .rpc();
        console.log(`Locked ${lockAmounts[i]} tokens for ${durations[i]}s.`);
      }

      await new Promise(res => setTimeout(res, 6000));
      for (let i = 0; i < lockPdas.length; i++) {
        const txSig = await program.methods
          .withdrawTokens(new BN(lockIdCounter - lockPdas.length + 1 + i))
          .accounts({
            lockAccount: lockPdas[i],
            user: user.publicKey,
            userTokenAccount: userTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            smartWallet: smartWallet.publicKey,
            governor: governorPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([smartWallet, user])
          .rpc();
        console.log(`WithdrawTokens TX #10.8.${i + 1}:`, txSig);
      }

      const userBal = await getAccount(connection, userTokenAccount);
      assert.equal(userBal.amount.toString(), "1000");

      // check escrow is empty
      const escrowBal = await getAccount(connection, escrowTokenAccount);
      assert.equal(escrowBal.amount.toString(), "0");

      // check each lockAccount is withdrawn
      for (const pda of lockPdas) {
        const la = await program.account.lockAccount.fetch(pda);
        assert.isTrue(la.withdrawn, "LockAccount should be withdrawn");
      }
    } catch (error: any) {
      console.error("Error in Test Case 10.8:", error);
      assert.fail(`Test Case 10.8 failed: ${error.message}`);
    }
  });

  it("Test Case 10.9: Prevent exits with invalid parameters via multi-sig and expect failure", async () => {
    try {
      const invalidLockId = new BN(9999); 
      const invalidLockPda = await deriveLockAccountPda(governorPda, user.publicKey, invalidLockId);
      await program.methods
        .withdrawTokens(invalidLockId)
        .accounts({
          lockAccount: invalidLockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();

      assert.fail("Withdrawal from invalid lock_id should fail with 'AccountNotInitialised'");
    } catch (err: any) {
      console.log("Test Case 10.9 caught error:", err);
      //  Anchor won't find the LockAccount => "AccountNotInitialised"
      if (err.error?.errorCode?.code) {
        assert.equal(
          err.error.errorCode.code,
          "AccountNotInitialized",
          "Expected AccountNotInitialized error for invalid lock_id"
        );
      } else {
        assert.include(
          err.toString(),
          "AccountNotInitialized",
          "Expected AccountNotInitialized or similar"
        );
      }
      console.log("Test Case 10.9 passed (failed as expected).");
    }
  });

  it("Test Case 10.10: Ensure integration with Locker parameters during exit operations via multi-sig", async () => {
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
      const amount = new BN(80);
      const duration = new BN(5);
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      console.log(`Locked ${amount} tokens for ${duration}s. Checking locker integration...`);
      // Wait for expiry
      await new Promise(res => setTimeout(res, duration.toNumber() * 1000 + 1000));
      // withdraw
      const txSig = await program.methods
        .withdrawTokens(lockId)
        .accounts({
          lockAccount: lockPda,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          smartWallet: smartWallet.publicKey,
          governor: governorPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([smartWallet, user])
        .rpc();
      console.log("WithdrawTokens TX #10.10:", txSig);
      //  confirm lockAccount is withdrawn
      const lockAcc = await program.account.lockAccount.fetch(lockPda);
      assert.isTrue(lockAcc.withdrawn, "LockAccount should be withdrawn");
      // Escrow is empty
      const escrowBal = await getAccount(connection, escrowTokenAccount);
      assert.equal(escrowBal.amount.toString(), "0");
    } catch (error: any) {
      console.error("Error in Test Case 10.10:", error);
      assert.fail(`Test Case 10.10 failed: ${error.message}`);
    }
  });
});
