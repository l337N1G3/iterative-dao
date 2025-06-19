import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

describe('iterative-dao: User Story 2', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: anchor.web3.Keypair;
  let electorate: anchor.web3.Keypair;
  let governorPda: anchor.web3.PublicKey;
  let governorBump: number;
  const governanceMint = anchor.web3.Keypair.generate().publicKey;
  const deriveProposalPda = async (
    governorPda: anchor.web3.PublicKey,
    proposalCount: number
  ) => {
    return await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from('proposal'),
        governorPda.toBuffer(),
        Buffer.from(new anchor.BN(proposalCount).toArrayLike(Buffer, 'le', 8)),
      ],
      program.programId
    );
  };

  const logAccountDetails = async (accountPubkey: anchor.web3.PublicKey, accountName: string) => {
    try {
      if (accountName === "Governor Account") {
        const account = await program.account.governor.fetch(accountPubkey);
        console.log(`\n=== ${accountName} Details ===`);
        console.log(JSON.stringify(account, null, 2));
        console.log(`=== End of ${accountName} ===\n`);
      } else if (accountName === "Proposal Account") {
        const account = await program.account.proposal.fetch(accountPubkey);
        console.log(`\n=== ${accountName} Details ===`);
        console.log(JSON.stringify(account, null, 2));
        console.log(`=== End of ${accountName} ===\n`);
      }
    } catch (error) {
      console.error(`Failed to fetch ${accountName}:`, error);
    }
  };

  beforeEach(async () => {
    console.log("\n=== Running beforeEach setup ===");
    smartWallet = anchor.web3.Keypair.generate();
    electorate = anchor.web3.Keypair.generate();
    console.log("Smart Wallet Public Key:", smartWallet.publicKey.toBase58());
    console.log("Electorate Public Key:", electorate.publicKey.toBase58());

    // derive Governor PDA
    [governorPda, governorBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('governor'), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("Governor PDA:", governorPda.toBase58(), "with bump:", governorBump);
    console.log("=== beforeEach setup complete ===\n");
    console.log("Initializing Governor...");
    try {
      const initTx = await program.methods
        .initGovernor(
          60,                         // vote_threshold
          new anchor.BN(3600),        // timelock_delay
          electorate.publicKey,       // electorate
          governanceMint              // governanceMint
        )
        .accounts({
          governor: governorPda,
          payer: provider.wallet.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();

      console.log("Governor Initialisation Transaction Signature:", initTx);
      await provider.connection.confirmTransaction(initTx, "confirmed");
      console.log("Governor initialisation confirmed.");
      await logAccountDetails(governorPda, "Governor Account");
      console.log("Governor initialised successfully.\n");
    } catch (err) {
      console.error("Governor initialisation failed with error:", err);
      throw err;
    }
    console.log("Adding electorate as a valid voter in the governor...");
    try {
      const addVoterTx = await program.methods
        .addVoter(electorate.publicKey, new anchor.BN(10)) // weight = 10
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();

      console.log("Add Voter Transaction Signature:", addVoterTx);
      await provider.connection.confirmTransaction(addVoterTx, "confirmed");
      console.log(`Electorate ${electorate.publicKey.toBase58()} added as voter with weight=10.\n`);
    } catch (err) {
      console.error("Adding electorate as voter failed with error:", err);
      throw err;
    }
  });

  it('Test Case 2.1: Create Proposal with valid instructions via multi-sig and verify creation', async () => {
    console.log(">>> Starting Test Case 2.1: Create Proposal with valid instructions via multi-sig and verify creation");
    try {
      // valid instructions for proposal
      const proposalInstructions = [
        {
          programId: anchor.web3.SystemProgram.programId,
          accounts: [
            {
              pubkey: provider.wallet.publicKey,
              isSigner: true,
              isWritable: true,
            },
          ],
          data: Buffer.from("Sample instruction data"),
        },
      ];
      console.log("Proposal Instructions:", proposalInstructions);

      // get current proposal_count from Governor
      const governorAccount = await program.account.governor.fetch(governorPda);
      console.log("Governor Account Fetched:", governorAccount);
      const currentProposalCount = governorAccount.proposalCount.toNumber();
      console.log(`Current Proposal Count: ${currentProposalCount}`);

      // derive Proposal PDA using current proposal_count
      const [proposalPda, proposalBump] = await deriveProposalPda(governorPda, currentProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()} with bump: ${proposalBump}`);

      // create Proposal using electorate 
      const createProposalTx = await program.methods
        .createProposal(proposalInstructions)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();

      console.log("Create Proposal Transaction Signature:", createProposalTx);
      await provider.connection.confirmTransaction(createProposalTx, "confirmed");
      console.log("Proposal creation confirmed.");

      await logAccountDetails(proposalPda, "Proposal Account");

      // Assertions
      const proposalAccountFetched = await program.account.proposal.fetch(proposalPda);
      console.log("Fetched Proposal Account:", proposalAccountFetched);

      assert.strictEqual(
        proposalAccountFetched.proposalId.toNumber(),
        currentProposalCount,
        "Proposal ID should match current proposal count"
      );
      assert.deepEqual(
        proposalAccountFetched.state,
        { draft: {} },
        "Proposal state should be Draft"
      );
      assert.strictEqual(
        proposalAccountFetched.instructions.length,
        1,
        "Proposal should have 1 instruction"
      );
      assert.strictEqual(
        proposalAccountFetched.instructions[0].programId.toBase58(),
        anchor.web3.SystemProgram.programId.toBase58(),
        "Instruction program ID should match"
      );
      assert.strictEqual(
        proposalAccountFetched.instructions[0].data.toString(),
        "Sample instruction data",
        "Instruction data should match"
      );

      // verify proposal_count has incremented
      const updatedGovernorAccount = await program.account.governor.fetch(governorPda);
      console.log("Fetched Governor Account After Proposal Creation:", updatedGovernorAccount);
      assert.strictEqual(
        updatedGovernorAccount.proposalCount.toNumber(),
        currentProposalCount + 1,
        "Proposal count should increment correctly"
      );

      console.log("<<< Test Case 2.1 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 2.1 failed with error:", err);
      throw err;
    }
  });

  it('Test Case 2.2: Ensure proposer linkage within multi-sig context', async () => {
    console.log(">>> Starting Test Case 2.2: Ensure proposer linkage within multi-sig context");
    try {
      const proposalInstructions = [
        {
          programId: anchor.web3.SystemProgram.programId,
          accounts: [
            {
              pubkey: provider.wallet.publicKey,
              isSigner: true,
              isWritable: true,
            },
          ],
          data: Buffer.from("Sample instruction for proposer linkage"),
        },
      ];
      console.log("Proposal Instructions:", proposalInstructions);
      const governorAccount = await program.account.governor.fetch(governorPda);
      console.log("Governor Account Fetched:", governorAccount);
      const currentProposalCount = governorAccount.proposalCount.toNumber();
      console.log(`Current Proposal Count: ${currentProposalCount}`);
      const [proposalPda, proposalBump] = await deriveProposalPda(governorPda, currentProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()} with bump: ${proposalBump}`);
      const createProposalTx = await program.methods
        .createProposal(proposalInstructions)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      console.log("Create Proposal Transaction Signature:", createProposalTx);
      await provider.connection.confirmTransaction(createProposalTx, "confirmed");
      console.log("Proposal creation confirmed.");
      await logAccountDetails(proposalPda, "Proposal Account");
      const proposalAccountFetched = await program.account.proposal.fetch(proposalPda);
      console.log("Fetched Proposal Account:", proposalAccountFetched);
      // ensure proposer linkage
      assert.strictEqual(
        proposalAccountFetched.proposer.toBase58(),
        electorate.publicKey.toBase58(),
        "Proposer should be correctly linked to the electorate"
      );
      console.log("<<< Test Case 2.2 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 2.2 failed with error:", err);
      throw err;
    }
  });


  it('Test Case 2.3: Confirm proposal count increments through Governor', async () => {
    console.log(">>> Starting Test Case 2.3: Confirm proposal count increments through Governor");
    try {
      const proposalInstructions = [
        {
          programId: anchor.web3.SystemProgram.programId,
          accounts: [
            {
              pubkey: provider.wallet.publicKey,
              isSigner: true,
              isWritable: true,
            },
          ],
          data: Buffer.from("Sample instruction for proposal count increment"),
        },
      ];
      console.log("Proposal Instructions:", proposalInstructions);
      const governorAccountBefore = await program.account.governor.fetch(governorPda);
      console.log("Governor Account Before:", governorAccountBefore);
      const initialProposalCount = governorAccountBefore.proposalCount.toNumber();
      console.log(`Initial Proposal Count: ${initialProposalCount}`);
      const [proposalPda, proposalBump] = await deriveProposalPda(governorPda, initialProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()} with bump: ${proposalBump}`);
      const createProposalTx = await program.methods
        .createProposal(proposalInstructions)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      console.log("Create Proposal Transaction Signature:", createProposalTx);
      await provider.connection.confirmTransaction(createProposalTx, "confirmed");
      console.log("Proposal creation confirmed.");
      const governorAccountAfter = await program.account.governor.fetch(governorPda);
      console.log("Governor Account After:", governorAccountAfter);
      const updatedProposalCount = governorAccountAfter.proposalCount.toNumber();
      console.log(`Updated Proposal Count: ${updatedProposalCount}`);
      assert.strictEqual(
        updatedProposalCount,
        initialProposalCount + 1,
        "Proposal count should increment by one"
      );
      console.log("<<< Test Case 2.3 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 2.3 failed with error:", err);
      throw err;
    }
  });

  it('Test Case 2.4: Attempt creation without required multi-sig approvals and expect failure', async () => {
    console.log(">>> Starting Test Case 2.4: Attempt creation without required multi-sig approvals and expect failure");
    try {
      const invalidProposalInstructions: any[] = [
        {
          programId: anchor.web3.SystemProgram.programId,
          accounts: [],
          data: Buffer.from("Should fail due to missing signature"),
        },
      ];
      const governorAccount = await program.account.governor.fetch(governorPda);
      const currentProposalCount = governorAccount.proposalCount.toNumber();
      console.log(`Current Proposal Count: ${currentProposalCount}`);
      const [proposalPda] = await deriveProposalPda(governorPda, currentProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()}`);

      try {
        const createProposalTx = await program.methods
          .createProposal(invalidProposalInstructions)
          .accounts({
            governor: governorPda,
            proposal: proposalPda,
            proposer: electorate.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        console.log("Create Proposal Transaction Signature:", createProposalTx);
        assert.fail('Expected transaction to fail due to missing multi-sig signature');
      } catch (err: any) {
        console.error("Expected failure caught in Test Case 2.4:", err);
        assert.include(
          err.message,
          'Signature verification failed',
          "Should fail: signature missing"
        );
        console.log("<<< Test Case 2.4 completed successfully.\n");
      }
    } catch (err) {
      console.error("Test Case 2.4 encountered an unexpected error:", err);
      throw err;
    }
  });


  it('Test Case 2.5: Attempt creation with invalid instructions and expect failure', async () => {
    console.log(">>> Starting Test Case 2.5: Attempt creation with invalid instructions and expect failure");
    try {
      const invalidProposalInstructions: any[] = [];
      console.log("Invalid Proposal Instructions:", invalidProposalInstructions);
      const governorAccount = await program.account.governor.fetch(governorPda);
      const currentProposalCount = governorAccount.proposalCount.toNumber();
      console.log(`Current Proposal Count: ${currentProposalCount}`);
      const [proposalPda] = await deriveProposalPda(governorPda, currentProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()}`);
      try {
        const createProposalTx = await program.methods
          .createProposal(invalidProposalInstructions)
          .accounts({
            governor: governorPda,
            proposal: proposalPda,
            proposer: electorate.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([electorate])
          .rpc();

        console.log("Create Proposal Transaction Signature:", createProposalTx);
        assert.fail('Expected transaction to fail due to invalid instructions');
      } catch (err: any) {
        console.error("Expected failure caught in Test Case 2.5:", err);
        assert.include(
          err.message,
          'Invalid instructions',
          "Error message should include 'Invalid instructions'"
        );
        console.log("<<< Test Case 2.5 completed successfully.\n");
      }
    } catch (err) {
      console.error("Test Case 2.5 encountered an unexpected error:", err);
      throw err;
    }
  });


  it('Test Case 2.6: Verify Proposal state is initialised to Draft', async () => {
    console.log(">>> Starting Test Case 2.6: Verify Proposal state is initialised to Draft");
    try {
      const proposalInstructions = [
        {
          programId: anchor.web3.SystemProgram.programId,
          accounts: [
            {
              pubkey: provider.wallet.publicKey,
              isSigner: true,
              isWritable: true,
            },
          ],
          data: Buffer.from("Sample instruction for proposal state verification"),
        },
      ];
      const governorAccount = await program.account.governor.fetch(governorPda);
      const currentProposalCount = governorAccount.proposalCount.toNumber();
      console.log(`Current Proposal Count: ${currentProposalCount}`);
      const [proposalPda] = await deriveProposalPda(governorPda, currentProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()}`);
      const createProposalTx = await program.methods
        .createProposal(proposalInstructions)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      console.log("Create Proposal Transaction Signature:", createProposalTx);
      await provider.connection.confirmTransaction(createProposalTx, "confirmed");
      console.log("Proposal creation confirmed.");
      await logAccountDetails(proposalPda, "Proposal Account");
      const proposalAccountFetched = await program.account.proposal.fetch(proposalPda);
      console.log("Fetched Proposal Account:", proposalAccountFetched);
      assert.deepEqual(
        proposalAccountFetched.state,
        { draft: {} },
        "Proposal state should be Draft initially"
      );
      console.log("<<< Test Case 2.6 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 2.6 failed with error:", err);
      throw err;
    }
  });

  it('Test Case 2.7: Ensure Smart Wallet instructions are stored correctly', async () => {
    console.log(">>> Starting Test Case 2.7: Ensure Smart Wallet instructions are stored correctly");
    try {
      const smartWalletInstructions = [
        {
          programId: anchor.web3.SystemProgram.programId,
          accounts: [
            {
              pubkey: provider.wallet.publicKey,
              isSigner: true,
              isWritable: true,
            },
          ],
          data: Buffer.from("Specific instructions for Smart Wallet operations"),
        },
      ];
      console.log("Smart Wallet Instructions:", smartWalletInstructions);
      const governorAccount = await program.account.governor.fetch(governorPda);
      const currentProposalCount = governorAccount.proposalCount.toNumber();
      console.log(`Current Proposal Count: ${currentProposalCount}`);
      const [proposalPda] = await deriveProposalPda(governorPda, currentProposalCount);
      console.log(`Derived Proposal PDA: ${proposalPda.toBase58()}`);
      const createProposalTx = await program.methods
        .createProposal(smartWalletInstructions)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      console.log("Create Proposal Transaction Signature:", createProposalTx);
      await provider.connection.confirmTransaction(createProposalTx, "confirmed");
      console.log("Proposal creation confirmed.");
      await logAccountDetails(proposalPda, "Proposal Account");
      const proposalAccountFetched = await program.account.proposal.fetch(proposalPda);
      console.log("Fetched Proposal Account:", proposalAccountFetched);
      assert.strictEqual(
        proposalAccountFetched.instructions.length,
        smartWalletInstructions.length,
        "Number of instructions should match"
      );
      for (let i = 0; i < smartWalletInstructions.length; i++) {
        const expected = smartWalletInstructions[i];
        const stored = proposalAccountFetched.instructions[i];
        assert.strictEqual(
          stored.programId.toBase58(),
          expected.programId.toBase58(),
          `Instruction ${i + 1} program ID should match`
        );
        assert.strictEqual(
          stored.data.toString(),
          expected.data.toString(),
          `Instruction ${i + 1} data should match`
        );
      }

      console.log("<<< Test Case 2.7 completed successfully.\n");
    } catch (err) {
      console.error("Test Case 2.7 failed with error:", err);
      throw err;
    }
  });
});
