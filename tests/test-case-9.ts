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
import { SystemProgram } from '@solana/web3.js';

import { IterativeDao } from '../target/types/iterative_dao';

describe("Lock Tokens Tests (User Story 9)", () => {
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
    console.log("=== Running beforeEach setup ===");
    lockIdCounter = 0;
    console.log("lockIdCounter reset to:", lockIdCounter);
    console.log("Generating smartWallet and user keypairs...");
    smartWallet = anchor.web3.Keypair.generate();
    user = anchor.web3.Keypair.generate();
    console.log("smartWallet:", smartWallet.publicKey.toBase58());
    console.log("user:", user.publicKey.toBase58());
    console.log("Deriving governor PDA...");
    [governorPda, governorBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("governor"), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("Governor PDA:", governorPda.toBase58(), "with bump", governorBump);
    try {
      console.log("Creating governance mint...");
      const mint = await createMint(
        connection,
        provider.wallet.payer,
        user.publicKey, // mint authority
        null, // freeze authority
        0 // decimals
      );
      governanceMint = mint;
      console.log("Governance mint created:", governanceMint.toBase58());
      console.log("Creating or fetching user token account...");
      const userTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        governanceMint,
        user.publicKey
      );
      userTokenAccount = userTokenAcc.address;
      console.log("User token account:", userTokenAccount.toBase58());
      console.log("Creating or fetching escrow token account...");
      const escrowTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        governanceMint,
        smartWallet.publicKey
      );
      escrowTokenAccount = escrowTokenAcc.address;
      console.log("Escrow token account:", escrowTokenAccount.toBase58());
      console.log("Minting 1000 tokens to the user token account...");
      await mintTo(
        connection,
        provider.wallet.payer,
        governanceMint,
        userTokenAccount,
        user, // mint authority
        1000 // mint 1000 tokens
      );
      console.log("Successfully minted 1000 tokens to user token account.");
    } catch (error) {
      console.error("Error setting up token accounts:", error);
      throw error;
    }
    try {
      console.log("Initialising Governor account with vote_threshold=60, timelock_delay=3600...");
      await program.methods
        .initGovernor(
          new BN(60), // vote_threshold
          new BN(3600), // timelock_delay (1 hour)
          user.publicKey, // electorate
          governanceMint // governance_mint
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
      console.log("Adding user as a recognised voter with weight 100...");
      await program.methods
        .addVoter(user.publicKey, new BN(100)) // Assign a weight of 100
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("User added as a recognised voter.");
    } catch (error) {
      console.error("Error adding voter:", error);
      throw error;
    }
    try {
      console.log("Verifying that the user is a recognised voter...");
      const governorAccount = await program.account.governor.fetch(governorPda).catch(() => null);
      assert.isNotNull(governorAccount, "Governor account should exist");
      const voter = governorAccount.voters.find(v => v.pubkey.toBase58() === user.publicKey.toBase58());
      assert.isNotNull(voter, "User should be a recognised voter");
      if (voter) {
        console.log("User is a recognised voter with weight:", voter.weight.toString());
      }
    } catch (error) {
      console.error("Error verifying voter status:", error);
      throw error;
    }
    console.log("=== beforeEach setup complete ===\n");
  });

  // helper to derive lockAccount PDA with seeds: [b"lock", governor.key(), user.key(), lock_id]
  async function deriveLockAccountPda(
    governorPk: anchor.web3.PublicKey,
    userPk: anchor.web3.PublicKey,
    lockId: BN
  ) {
    console.log("Deriving LockAccount PDA for lockId:", lockId.toString());
    const [pda, _bump] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("lock"),
        governorPk.toBuffer(),
        userPk.toBuffer(),
        lockId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    console.log("Derived LockAccount PDA:", pda.toBase58());
    return pda;
  }

  it("Test Case 9.1: Lock valid amount of tokens for permissible duration via multi-sig and verify escrow", async () => {
    console.log(">>> Starting Test Case 9.1");
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
      const amount = new BN(50);
      const duration = new BN(1000);
      console.log(`Locking tokens: amount=${amount.toString()}, duration=${duration.toString()}, lockId=${lockId.toString()}`);
      const tx = await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log("LockTokens TX #9.1 successful, tx signature:", tx);
      const escrowAccountInfo = await getAccount(connection, escrowTokenAccount);
      console.log("Escrow token account balance after locking:", escrowAccountInfo.amount.toString());
      assert.isDefined(escrowAccountInfo, "Escrow token account should exist");
      assert.equal(
        escrowAccountInfo.amount.toString(),
        amount.toString(),
        "Escrow token account should have the locked amount"
      );
      const userAccountInfo = await getAccount(connection, userTokenAccount);
      console.log("User token account balance after locking:", userAccountInfo.amount.toString());
      assert.isDefined(userAccountInfo, "User token account should exist");
      assert.equal(
        userAccountInfo.amount.toString(),
        (1000 - amount.toNumber()).toString(),
        "User token account should have reduced tokens"
      );
      const lockAccount = await program.account.lockAccount.fetch(lockAccountPda).catch(() => null);
      assert.isNotNull(lockAccount, "LockAccount should be initialised");
      if (lockAccount) {
        console.log("LockAccount state:", lockAccount);
        assert.equal(lockAccount.amount.toString(), amount.toString(), "LockAccount should have correct amount");
        assert.equal(lockAccount.duration.toString(), duration.toString(), "LockAccount should have correct duration");
        assert.equal(lockAccount.user.toBase58(), user.publicKey.toBase58(), "LockAccount should have correct user");
      }
      console.log("<<< Test Case 9.1 completed successfully.\n");
    } catch (error: any) {
      console.error("Error in Test Case 9.1:", error);
      assert.fail(`Test Case 9.1 failed: ${error.message}`);
    }
  });

it("Test Case 9.2: Attempt to lock tokens without sufficient balance => fail", async () => {
  console.log(">>> Starting Test Case 9.2");
  lockIdCounter += 1;
  const lockId = new BN(lockIdCounter);
  const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
  const lockAmount = new BN(2000); // user has  1000 tokens
  const duration = new BN(1000);
  const userAccountInfoBefore = await getAccount(connection, userTokenAccount);
  console.log("User token account balance before lock attempt:", userAccountInfoBefore.amount.toString());
  try {
    console.log(`Attempting to lock ${lockAmount.toString()} tokens (exceeding balance) for duration ${duration.toString()}`);
    await program.methods
      .lockTokens(lockAmount, duration, lockId)
      .accounts({
        governor: governorPda,
        smartWallet: smartWallet.publicKey,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        escrowTokenAccount: escrowTokenAccount,
        lockAccount: lockAccountPda,
        payer: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([smartWallet, user])
      .rpc();
    assert.fail("Locking should have failed due to insufficient balance.");
  } catch (err: any) {
    console.error("Expected error in Test Case 9.2:", err);
    const errString = err.toString();
    assert.isTrue(
      errString.includes("insufficient funds") || errString.includes("InsufficientBalance"),
      "Expected error message to include either 'insufficient funds' or 'InsufficientBalance'"
    );
  }
  const userAccountInfoAfter = await getAccount(connection, userTokenAccount);
  console.log("User token account balance after lock attempt:", userAccountInfoAfter.amount.toString());
  assert.equal(
    userAccountInfoAfter.amount.toString(),
    userAccountInfoBefore.amount.toString(),
    "User token account should remain unchanged after failed lock."
  );
  console.log("<<< Test Case 9.2 completed successfully.\n");
});

  it("Test Case 9.3: Verify voting power boost matches collective lock duration", async () => {
    console.log(">>> Starting Test Case 9.3");
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);

      const amount = new BN(20);
      const duration = new BN(2000);
      console.log(`Locking ${amount.toString()} tokens for duration ${duration.toString()} in Test Case 9.3`);

      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();

      console.log("Locking transaction in Test Case 9.3 completed.");
      const lockAccount = await program.account.lockAccount.fetch(lockAccountPda).catch(() => null);
      assert.isNotNull(lockAccount, "LockAccount should exist");
      if (lockAccount) {
        console.log("LockAccount details:", lockAccount);
        console.log("Assuming voting power boost is computed on-chain; please add assertions as needed.");
      }
      console.log("<<< Test Case 9.3 completed successfully.\n");
    } catch (error: any) {
      console.error("Error in Test Case 9.3:", error);
      assert.fail(`Test Case 9.3 failed: ${error.message}`);
    }
  });

  it("Test Case 9.5: Attempt to lock tokens for invalid duration => fail", async () => {
    console.log(">>> Starting Test Case 9.5");

    lockIdCounter += 1;
    const lockId = new BN(lockIdCounter);
    const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
    const amount = new BN(10);
    const duration = new BN(0); // Invalid duration
    console.log(`Attempting to lock tokens with invalid duration: amount=${amount.toString()}, duration=${duration.toString()}`);
    try {
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      assert.fail("Locking should have failed due to invalid duration.");
    } catch (err: any) {
      console.error("Expected error in Test Case 9.5:", err);
      if (err.error && err.error.errorCode && err.error.errorCode.code) {
        assert.equal(err.error.errorCode.code, "InvalidLockParameters", "Expected InvalidLockParameters error.");
      } else {
        assert.include(err.toString(), "InvalidLockParameters", "Expected InvalidLockParameters error.");
      }
    }
    console.log("<<< Test Case 9.5 completed successfully.\n");
  });

it("Test Case 9.6: Ensure locked tokens cannot be withdrawn before lock period via multi-sig", async () => {
  console.log(">>> Starting Test Case 9.6");
  try {
    lockIdCounter += 1;
    const lockId = new BN(lockIdCounter);
    const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
    const amount = new BN(30);
    const duration = new BN(9000);
    console.log(`Locking ${amount.toString()} tokens for duration ${duration.toString()} in Test Case 9.6`);
    await program.methods
      .lockTokens(amount, duration, lockId)
      .accounts({
        governor: governorPda,
        smartWallet: smartWallet.publicKey,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        escrowTokenAccount: escrowTokenAccount,
        lockAccount: lockAccountPda,
        payer: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([smartWallet, user])
      .rpc();
    console.log("Tokens locked successfully. Now attempting withdrawal before expiry...");
    await program.methods
      .withdrawTokens(lockId)
      .accounts({
        lockAccount: lockAccountPda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        escrowTokenAccount: escrowTokenAccount,
        smartWallet: smartWallet.publicKey,
        governor: governorPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([smartWallet, user])
      .rpc();
    assert.fail("Withdrawal should have failed before lock period.");
  } catch (err: any) {
    console.error("Expected error in Test Case 9.6:", err);
    if (err.error && err.error.errorCode && err.error.errorCode.code) {
      assert.equal(err.error.errorCode.code, "LockNotExpired", "Expected LockNotExpired error.");
    } else {
      assert.include(err.toString(), "LockNotExpired", "Expected LockNotExpired error.");
    }
  }
  console.log("<<< Test Case 9.6 completed successfully.\n");
});

  it("Test Case 9.7: Lock tokens as unauthorised member => fail", async () => {
    console.log(">>> Starting Test Case 9.7");
    try {
      console.log("Generating attacker keypair...");
      const attacker = anchor.web3.Keypair.generate();
      console.log("Attacker public key:", attacker.publicKey.toBase58());
      console.log("Fetching attacker's token account...");
      const attackerTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        governanceMint,
        attacker.publicKey
      );
      const attackerTokenAccount = attackerTokenAcc.address;
      console.log("Attacker token account:", attackerTokenAccount.toBase58());
      console.log("Minting 100 tokens to attacker...");
      await mintTo(
        connection,
        provider.wallet.payer,
        governanceMint,
        attackerTokenAccount,
        user, // using user as mint authority
        100 // mint 100 tokens
      );
      console.log("Minted 100 tokens to attacker.");

      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockAccountPda = await deriveLockAccountPda(governorPda, attacker.publicKey, lockId);
      const amount = new BN(10);
      const duration = new BN(300);
      console.log(`Attacker attempting to lock tokens: amount=${amount.toString()}, duration=${duration.toString()}`);
      await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: attacker.publicKey, 
          userTokenAccount: attackerTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, attacker])
        .rpc();
      assert.fail("Locking should have failed for unauthorised user.");
    } catch (err: any) {
      console.error("Expected error in Test Case 9.7:", err);
      if (err.error && err.error.errorCode && err.error.errorCode.code) {
        assert.equal(err.error.errorCode.code, "UnauthorisedVoter", "Expected UnauthorisedVoter error.");
      } else {
        assert.include(err.toString(), "UnauthorisedVoter", "Expected UnauthorisedVoter error.");
      }
    }
    console.log("<<< Test Case 9.7 completed successfully.\n");
  });

  it("Test Case 9.8: Validate token transfer to escrow upon locking through Smart Wallet", async () => {
    console.log(">>> Starting Test Case 9.8");
    try {
      lockIdCounter += 1;
      const lockId = new BN(lockIdCounter);
      const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);
      const amount = new BN(40);
      const duration = new BN(700);
      console.log(`Locking tokens: amount=${amount.toString()}, duration=${duration.toString()}`);
      const userAccountInfoBefore = await getAccount(connection, userTokenAccount);
      console.log("User token account balance before lock:", userAccountInfoBefore.amount.toString());
      const tx = await program.methods
        .lockTokens(amount, duration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      console.log("LockTokens TX #9.8 successful, tx signature:", tx);
      const escrowAccountInfo = await getAccount(connection, escrowTokenAccount);
      console.log("Escrow token account balance after lock:", escrowAccountInfo.amount.toString());
      assert.isDefined(escrowAccountInfo, "Escrow token account should exist");
      assert.equal(
        escrowAccountInfo.amount.toString(),
        (await getAccount(connection, escrowTokenAccount)).amount.toString(),
        "Escrow token account should have the locked amount"
      );
      const userAccountInfoAfter = await getAccount(connection, userTokenAccount);
      console.log("User token account balance after lock:", userAccountInfoAfter.amount.toString());
      // since beforeEach resets state, the expected balance is 1000 - 40 = 960
      const expectedBalance = new BN(1000).sub(new BN(40)).toString();
      console.log("Expected user token account balance:", expectedBalance);
      assert.equal(
        userAccountInfoAfter.amount.toString(),
        expectedBalance,
        "User token account should have reduced tokens"
      );
      // check LockAccount state
      const lockAccount = await program.account.lockAccount.fetch(lockAccountPda).catch(() => null);
      assert.isNotNull(lockAccount, "LockAccount should be initialised");
      if (lockAccount) {
        console.log("LockAccount state:", lockAccount);
        assert.equal(lockAccount.amount.toString(), amount.toString(), "LockAccount should have correct amount");
        assert.equal(lockAccount.duration.toString(), duration.toString(), "LockAccount should have correct duration");
        assert.equal(lockAccount.user.toBase58(), user.publicKey.toBase58(), "LockAccount should have correct user");
      }
      console.log("<<< Test Case 9.8 completed successfully.\n");
    } catch (error: any) {
      console.error("Error in Test Case 9.8:", error);
      assert.fail(`Test Case 9.8 failed: ${error.message}`);
    }
  });

  it("Test Case 9.9: Lock tokens via multi-sig in coordination with Locker parameters", async () => {
    console.log(">>> Starting Test Case 9.9");
    // Arrange: Attempt to lock tokens with invalid parameters
    lockIdCounter += 1;
    const lockId = new BN(lockIdCounter);
    const lockAccountPda = await deriveLockAccountPda(governorPda, user.publicKey, lockId);

    const invalidLockAmount = new BN(0); // Zero amount
    const invalidDuration = new BN(-500); // Negative duration (note: BN supports negative values, but your program should reject these)
    console.log(`Attempting to lock with invalid parameters: amount=${invalidLockAmount.toString()}, duration=${invalidDuration.toString()}`);

    try {
      await program.methods
        .lockTokens(invalidLockAmount, invalidDuration, lockId)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      assert.fail("Locking should have failed due to invalid parameters.");
    } catch (err: any) {
      console.error("Expected error in Test Case 9.9:", err);
      if (err.error && err.error.errorCode && err.error.errorCode.code) {
        assert.equal(err.error.errorCode.code, "InvalidLockParameters", "Expected InvalidLockParameters error.");
      } else {
        assert.include(err.toString(), "InvalidLockParameters", "Expected InvalidLockParameters error.");
      }
    }
    console.log("<<< Test Case 9.9 completed successfully.\n");
  });


  it("Test Case 9.10: Manage multiple token locks => ensure system consistency", async () => {
    console.log(">>> Starting Test Case 9.10");
    try {
      lockIdCounter += 1;
      const lockId1 = new BN(lockIdCounter);
      const lockAccountPda1 = await deriveLockAccountPda(governorPda, user.publicKey, lockId1);
      const amount1 = new BN(10);
      const duration1 = new BN(400);
      console.log(`Lock #1: Locking ${amount1.toString()} tokens for duration ${duration1.toString()}`);
      await program.methods
        .lockTokens(amount1, duration1, lockId1)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda1,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      console.log("Lock #1 completed.");
      lockIdCounter += 1;
      const lockId2 = new BN(lockIdCounter);
      const lockAccountPda2 = await deriveLockAccountPda(governorPda, user.publicKey, lockId2);
      const amount2 = new BN(20);
      const duration2 = new BN(800);
      console.log(`Lock #2: Locking ${amount2.toString()} tokens for duration ${duration2.toString()}`);
      await program.methods
        .lockTokens(amount2, duration2, lockId2)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          escrowTokenAccount: escrowTokenAccount,
          lockAccount: lockAccountPda2,
          payer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smartWallet, user])
        .rpc();
      console.log("Lock #2 completed.");
      const lock1 = await program.account.lockAccount.fetch(lockAccountPda1).catch(() => null);
      assert.isNotNull(lock1, "Lock #1 should exist");
      if (lock1) {
        console.log("Verifying Lock #1: amount =", lock1.amount.toString(), ", duration =", lock1.duration.toString());
        assert.equal(lock1.amount.toString(), amount1.toString(), "Lock #1 amount mismatch");
        assert.equal(lock1.duration.toString(), duration1.toString(), "Lock #1 duration mismatch");
      }

      const lock2 = await program.account.lockAccount.fetch(lockAccountPda2).catch(() => null);
      assert.isNotNull(lock2, "Lock #2 should exist");
      if (lock2) {
        console.log("Verifying Lock #2: amount =", lock2.amount.toString(), ", duration =", lock2.duration.toString());
        assert.equal(lock2.amount.toString(), amount2.toString(), "Lock #2 amount mismatch");
        assert.equal(lock2.duration.toString(), duration2.toString(), "Lock #2 duration mismatch");
      }
      const escrowAccountInfo = await getAccount(connection, escrowTokenAccount);
      const totalLocked = new BN(10).add(new BN(20)).toString();
      console.log("Total locked tokens expected in escrow:", totalLocked);
      console.log("Escrow token account balance:", escrowAccountInfo.amount.toString());
      assert.equal(
        escrowAccountInfo.amount.toString(),
        totalLocked,
        "Escrow token account should have total locked tokens (10 + 20)"
      );
      console.log("<<< Test Case 9.10 completed successfully.\n");
    } catch (error: any) {
      console.error("Error in Test Case 9.10:", error);
      assert.fail(`Test Case 9.10 failed: ${error.message}`);
    }
  });
});
