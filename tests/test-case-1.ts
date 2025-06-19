import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

describe('iterative-dao', () => {

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: anchor.web3.Keypair;
  let electorate: anchor.web3.Keypair;
  let governorPda: anchor.web3.PublicKey;
  let bump: number;
  const governanceMint = anchor.web3.Keypair.generate().publicKey;

  const logAccountDetails = async (accountPubkey: anchor.web3.PublicKey, accountName: string) => {
    try {
      const account = await program.account.governor.fetch(accountPubkey);
      console.log(`\n=== ${accountName} Details ===`);
      console.log(JSON.stringify(account, null, 2));
      console.log(`=== End of ${accountName} ===\n`);
    } catch (error) {
      console.error(`Failed to fetch ${accountName}:`, error);
    }
  };

  beforeEach(async () => {
    console.log("\n--- Setting up before each test ---");
    smartWallet = anchor.web3.Keypair.generate();
    electorate = anchor.web3.Keypair.generate();
    console.log(`Smart Wallet Public Key: ${smartWallet.publicKey.toBase58()}`);
    console.log(`Electorate Public Key: ${electorate.publicKey.toBase58()}`);
    [governorPda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('governor'), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log(`Governor PDA: ${governorPda.toBase58()} with bump: ${bump}`);
    console.log("--- Setup complete ---\n");
  });

  it('Test Case 1.1: Initialise Governor with valid parameters via multi-sig', async () => {
    console.log(">>> Starting Test Case 1.1: Initialise Governor with valid parameters via multi-sig");
    try {
      const tx = await program.methods
        .initGovernor(60, new anchor.BN(3600), electorate.publicKey, governanceMint)
        .accounts({
          governor: governorPda,
          payer: provider.wallet.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log(`Transaction Signature: ${tx}`);
      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Transaction confirmed.");
      await logAccountDetails(governorPda, "Governor Account");
      const governorAccount = await program.account.governor.fetch(governorPda);
      assert.isTrue(governorAccount.isInitialised, "Governor should be initialised");
      assert.strictEqual(governorAccount.voteThreshold, 60, "Vote threshold should be 60");
      assert.equal(governorAccount.timelockDelay.toNumber(), 3600, "Timelock delay should be 3600");
      assert.isTrue(governorAccount.smartWallet.equals(smartWallet.publicKey), "Smart wallet should match");
      assert.isTrue(governorAccount.electorate.equals(electorate.publicKey), "Electorate should match");
      console.log("<<< Test Case 1.1 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 1.1 failed with error:", err);
      throw err; 
    }
  });

  it('Test Case 1.2: Ensure linkage to n/m Smart Wallet', async () => {
    console.log(">>> Starting Test Case 1.2: Ensure linkage to n/m Smart Wallet");
    try {
      const tx = await program.methods
        .initGovernor(60, new anchor.BN(3600), electorate.publicKey, governanceMint)
        .accounts({
          governor: governorPda,
          payer: provider.wallet.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log(`Transaction Signature: ${tx}`);
      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Transaction confirmed.");
      await logAccountDetails(governorPda, "Governor Account");
      const governorAccount = await program.account.governor.fetch(governorPda);
      assert.isTrue(governorAccount.smartWallet.equals(smartWallet.publicKey), "Smart wallet should be linked correctly");
      console.log("<<< Test Case 1.2 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 1.2 failed with error:", err);
      throw err;
    }
  });

  it('Test Case 1.3: Validate electorate and governance parameters', async () => {
    console.log(">>> Starting Test Case 1.3: Validate electorate and governance parameters");
    try {
      const tx = await program.methods
        .initGovernor(60, new anchor.BN(3600), electorate.publicKey, governanceMint)
        .accounts({
          governor: governorPda,
          payer: provider.wallet.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();

      console.log(`Transaction Signature: ${tx}`);
      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Transaction confirmed.");

      await logAccountDetails(governorPda, "Governor Account");

      const governorAccount = await program.account.governor.fetch(governorPda);
      assert.isTrue(governorAccount.electorate.equals(electorate.publicKey), "Electorate should match");
      assert.strictEqual(governorAccount.voteThreshold, 60, "Vote threshold should be 60");
      assert.equal(governorAccount.timelockDelay.toNumber(), 3600, "Timelock delay should be 3600");

      console.log("<<< Test Case 1.3 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 1.3 failed with error:", err);
      throw err;
    }
  });

  it('Test Case 1.4: Attempt creation without required multi-sig approvals and expect failure', async () => {
    console.log(">>> Starting Test Case 1.4: Attempt creation without required multi-sig approvals and expect failure");
    try {
      await program.methods
        // no signers = missing multi-sig approval
        .initGovernor(60, new anchor.BN(3600), electorate.publicKey, governanceMint)
        .accounts({
          governor: governorPda,
          payer: provider.wallet.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        // omitting .signers([smartWallet])
        .rpc();

      assert.fail('Expected transaction to fail due to missing multi-sig approval');
    } catch (err: any) {
      console.error("Expected failure caught in Test Case 1.4:", err);
      // error for missing signers is "Signature verification failed"
      assert.include(err.message, 'Signature verification failed', "Error message should include 'Signature verification failed'");
      console.log("<<< Test Case 1.4 completed successfully.\n");
    }
  });

  it('Test Case 1.5: Attempt creation with invalid parameters and expect failure', async () => {
    console.log(">>> Starting Test Case 1.5: Attempt creation with invalid parameters and expect failure");
    try {
      // 150 is out-of-range for vote threshold
      await program.methods
        .initGovernor(150, new anchor.BN(3600), electorate.publicKey, governanceMint)
        .accounts({
          governor: governorPda,
          payer: provider.wallet.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();

      assert.fail('Expected transaction to fail due to invalid vote threshold');
    } catch (err: any) {
      console.error("Expected failure caught in Test Case 1.5:", err);
      assert.include(err.message, 'InvalidVoteThreshold', "Error message should include 'InvalidVoteThreshold'");
      console.log("<<< Test Case 1.5 completed successfully.\n");
    }
  });
});
