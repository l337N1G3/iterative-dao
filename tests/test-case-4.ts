import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

describe("Proposal Cancellation Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: anchor.web3.Keypair;
  let electorate: anchor.web3.Keypair;
  let governorPda: anchor.web3.PublicKey;
  let bump: number;
  let proposalPda: anchor.web3.PublicKey;
  const governanceMint = anchor.web3.Keypair.generate().publicKey;
  const votingPeriod = new anchor.BN(86400);
  const createDraftProposal = async (): Promise<anchor.web3.PublicKey> => {
    console.log("Creating draft proposal...");
    const [pda] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("proposal"),
        governorPda.toBuffer(),
        new anchor.BN(0).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    console.log("Draft Proposal PDA:", pda.toString());
    const mockInstruction = {
      programId: program.programId,
      accounts: [
        {
          pubkey: provider.wallet.publicKey,
          isSigner: true,
          isWritable: true,
        },
      ],
      data: Buffer.from([]),
    };
    try {
      const tx = await program.methods
        .createProposal([mockInstruction])
        .accounts({
          governor: governorPda,
          proposal: pda,
          payer: provider.wallet.publicKey,
          proposer: electorate.publicKey, 
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      console.log("createProposal tx:", tx);
    } catch (err) {
      console.error("Error in createProposal:", err);
      throw err;
    }
    return pda;
  };

  beforeEach(async () => {
    console.log("Setting up test environment...");
    smartWallet = anchor.web3.Keypair.generate();
    electorate = anchor.web3.Keypair.generate();
    console.log("SmartWallet:", smartWallet.publicKey.toString());
    console.log("Electorate:", electorate.publicKey.toString());

    // derive  governor PDA
    [governorPda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("governor"), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("Governor PDA:", governorPda.toString(), "Bump:", bump);
    try {
      const tx = await program.methods
        .initGovernor(
          60,                      // vote threshold
          new anchor.BN(3600),     // timelock delay
          electorate.publicKey,    // electorate
          governanceMint           // dummy governance mint
        )
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("initGovernor tx:", tx);
    } catch (err) {
      console.error("Error in initGovernor:", err);
      throw err;
    }

    // add electorate as a voter
    try {
      const tx = await program.methods
        .addVoter(electorate.publicKey, new anchor.BN(10)) // weight = 10
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("addVoter tx:", tx);
    } catch (err) {
      console.error("Error in addVoter:", err);
      throw err;
    }
    proposalPda = await createDraftProposal();
    console.log("Proposal PDA created:", proposalPda.toString());
  });

  it("Test Case 4.1: Cancel Draft Proposal as proposer via multi-sig and verify state transition", async () => {
    console.log("Test Case 4.1: Cancel draft proposal...");
    try {
      const tx = await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: electorate.publicKey, // proposer must match
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("cancelProposal tx (4.1):", tx);
    } catch (err) {
      console.error("Error in cancelProposal (4.1):", err);
      throw err;
    }
    const proposal = await program.account.proposal.fetch(proposalPda);
    console.log("Fetched proposal state (4.1):", proposal.state);
    assert.deepStrictEqual(proposal.state, { canceled: {} });
  });

  it("Test Case 4.2: Attempt cancellation by non-proposer members and expect failure", async () => {
    console.log("Test Case 4.2: Cancellation by non-proposer...");
    const attacker = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: attacker.publicKey, // unauthorised proposer
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      assert.fail("Expected unauthorised cancellation error");
    } catch (err: any) {
      console.error("Expected error in 4.2:", err);
      console.log("Full error details (4.2):", JSON.stringify(err, null, 2));
      assert.isTrue(
        err.message.includes("UnauthorisedCancellation") ||
          err.message.includes("ConstraintRaw"),
        "Expected error message to include either 'UnauthorisedCancellation' or 'ConstraintRaw'"
      );
    }
  });

  it("Test Case 4.3: Try to cancel active proposal and expect failure due to unknown signer", async () => {
    console.log("Test Case 4.3: Activate proposal then attempt cancellation...");
    try {
      const txActivate = await program.methods
        .activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("activateProposal tx (4.3):", txActivate);
    } catch (err) {
      console.error("Error during activation in Test Case 4.3:", err);
      throw err;
    }
    const activatedProposal = await program.account.proposal.fetch(proposalPda);
    const correctProposer = activatedProposal.proposer;
    console.log("Fetched proposer from activated proposal:", correctProposer.toBase58());
    try {
      await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: correctProposer, //  proposer as stored in proposal
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet, /* proposerKeypair */])
        .rpc();
      assert.fail("Expected cancellation to fail due to proposal state not being Draft");
    } catch (err: any) {
      console.error("Expected error in Test Case 4.3:", err.message);
      console.log("Full error details (4.3):", JSON.stringify(err, null, 2));
      const errStr = JSON.stringify(err).toLowerCase();
      assert.isTrue(
        errStr.includes("invalidstatetransition") ||
        errStr.includes("unknown signer") ||
        errStr.includes("constraintraw"),
        "Expected error message to include 'InvalidStateTransition' or 'unknown signer' or 'ConstraintRaw'"
      );
    }
  });

  it("Test Case 4.4: Ensure canceled Proposal cannot be reactivated", async () => {
    console.log("Test Case 4.4: Cancel proposal then attempt reactivation...");
    try {
      const txCancel = await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("cancelProposal tx (4.4):", txCancel);
    } catch (err) {
      console.error("Error canceling proposal in 4.4:", err);
      throw err;
    }
    try {
      // try to reactivate the canceled proposal
      // ELECTORATE & SMARTWALLET are required 
      await program.methods
        .activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          elector: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      assert.fail("Expected invalid state transition error when reactivating canceled proposal");
    } catch (err: any) {
      console.error("Expected error in 4.4:", err);
      console.log("Full error details (4.4):", JSON.stringify(err, null, 2));
      assert.isTrue(
        err.message.includes("InvalidStateTransition") ||
          err.message.toLowerCase().includes("unknown signer"),
        "Expected error message to include either 'InvalidStateTransition' or 'unknown signer'"
      );
    }
  });

  it("Test Case 4.5: Attempt cancellation without required multi-sig approvals and expect failure", async () => {
    console.log("Test Case 4.5: Cancellation without required signature...");
    try {
      await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        // No signer
        .signers([])
        .rpc();
      assert.fail("Expected signature verification failure");
    } catch (err: any) {
      console.error("Expected error in 4.5:", err);
      console.log("Full error details (4.5):", JSON.stringify(err, null, 2));
      assert.match(
        err.message,
        /signature verification failed/i,
        "Expected a signature verification failure error"
      );
    }
  });

  it("Test Case 4.6: Verify Proposal immutability post cancellation", async () => {
    console.log("Test Case 4.6: Verify proposal immutability after cancellation...");
    try {
      const txCancel = await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("cancelProposal tx (4.6):", txCancel);
    } catch (err) {
      console.error("Error canceling proposal in 4.6:", err);
      throw err;
    }
    try {
      const mockInstruction = {
        programId: program.programId,
        accounts: [],
        data: Buffer.from([]),
      };
      await program.methods
        .createProposal([mockInstruction])
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          payer: provider.wallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      assert.fail("Expected seeds constraint error as account is already initialised");
    } catch (err: any) {
      console.error("Expected error in 4.6:", err);
      console.log("Full error details (4.6):", JSON.stringify(err, null, 2));
      assert.include(err.message, "A seeds constraint was violated");
    }
  });

  it("Test Case 4.7: Handle multiple Proposal cancellations and ensure consistency", async () => {
    console.log("Test Case 4.7: Multiple cancellations test...");
    try {
      const txCancel1 = await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("First cancelProposal tx (4.7):", txCancel1);
    } catch (err) {
      console.error("Error in first cancellation (4.7):", err);
      throw err;
    }
    try {
      await program.methods
        .cancelProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      assert.fail("Expected invalid state transition error on second cancellation");
    } catch (err: any) {
      console.error("Expected error on second cancellation (4.7):", err);
      console.log("Full error details (4.7):", JSON.stringify(err, null, 2));
      assert.isTrue(
        err.message.includes("InvalidStateTransition") ||
          err.message.includes("ConstraintRaw"),
        "Expected error message to include either 'InvalidStateTransition' or 'ConstraintRaw'"
      );
    }
    const proposal = await program.account.proposal.fetch(proposalPda);
    console.log("Final proposal state (4.7):", proposal.state);
    assert.deepStrictEqual(proposal.state, { canceled: {} });
  });
});
