import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import {
  AnchorProvider,
  Program,
  web3,
} from '@coral-xyz/anchor';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

import { IterativeDao } from '../target/types/iterative_dao';

describe("Proposal Queue Tests", () => {
  const provider = AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: web3.Keypair = provider.wallet.payer;
  let electorate: web3.Keypair;
  let governorPda: web3.PublicKey;
  let bump: number;
  let proposalPda: web3.PublicKey;
  const governanceMint = web3.Keypair.generate().publicKey;
  const votingPeriod = new anchor.BN(1);
  const createDraftProposal = async (): Promise<web3.PublicKey> => {
    console.log("Creating draft proposal...");
    const governorAccount = await program.account.governor.fetch(governorPda);
    const proposalCount = governorAccount.proposalCount;
    console.log("Current proposal count:", proposalCount.toString());
    const [pda] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from("proposal"),
        governorPda.toBuffer(),
        new anchor.BN(proposalCount).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    console.log("Draft Proposal PDA:", pda.toBase58());
    const mockInstruction = {
      programId: program.programId,
      accounts: [
        {
          pubkey: provider.wallet.publicKey,
          isSigner: true,
          isWritable: true,
        },
      ],
      data: Buffer.from("Test instruction"),
    };

    try {
      const tx = await program.methods
        .createProposal([mockInstruction])
        .accounts({
          governor: governorPda,
          proposal: pda,
          payer: provider.wallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: web3.SystemProgram.programId,
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
  const simulateVote = async (proposalPubkey: web3.PublicKey, weight: number) => {
    console.log("Simulating vote for proposal...");
    const [votePda] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from("vote"),
        proposalPubkey.toBuffer(),
        electorate.publicKey.toBuffer()
      ],
      program.programId
    );
    console.log("Derived vote PDA:", votePda.toBase58());
    try {
      const txCreate = await program.methods.createVote()
        .accounts({
          governor: governorPda,
          proposal: proposalPubkey,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log("createVote tx:", txCreate);
    } catch (err) {
      console.error("Error in createVote:", err);
      throw err;
    }
    try {
      const txCast = await program.methods.castVote({ for: {} } as any, new anchor.BN(weight))
        .accounts({
          governor: governorPda,
          proposal: proposalPubkey,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log("castVote tx:", txCast);
    } catch (err) {
      console.error("Error in castVote:", err);
      throw err;
    }
  };
  const finaliseProposal = async (proposalPubkey: web3.PublicKey) => {
    console.log("Activating proposal...");
    try {
      const txActivate = await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPubkey,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("activateProposal tx:", txActivate);
    } catch (err) {
      console.error("Error in activateProposal:", err);
      throw err;
    }
    await simulateVote(proposalPubkey, 10);
    console.log("Waiting for voting period to expire...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    try {
      const txFinalise = await program.methods.finaliseProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPubkey,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("finaliseProposal tx:", txFinalise);
    } catch (err) {
      console.error("Error in finaliseProposal:", err);
      throw err;
    }
  };

  beforeEach(async () => {
    console.log("\n=== Running beforeEach setup for Proposal Queue Tests ===");
    smartWallet = web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(smartWallet.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig);
    electorate = web3.Keypair.generate();
    console.log("SmartWallet:", smartWallet.publicKey.toBase58());
    console.log("Electorate:", electorate.publicKey.toBase58());
    [governorPda, bump] = await web3.PublicKey.findProgramAddress(
      [Buffer.from("governor"), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("Governor PDA:", governorPda.toBase58(), "Bump:", bump);
    try {
      const txInit = await program.methods.initGovernor(
        60,
        new anchor.BN(3600),
        electorate.publicKey,
        governanceMint
      )
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("initGovernor tx:", txInit);
    } catch (err) {
      console.error("Error in initGovernor:", err);
      throw err;
    }
    try {
      const txAdd = await program.methods.addVoter(electorate.publicKey, new anchor.BN(10))
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("addVoter tx:", txAdd);
    } catch (err) {
      console.error("Error in addVoter:", err);
      throw err;
    }
    try {
      proposalPda = await createDraftProposal();
      console.log("Proposal PDA created:", proposalPda.toBase58());
    } catch (err) {
      console.error("Error during proposal creation in beforeEach:", err);
      throw err;
    }
    console.log("=== beforeEach setup complete ===\n");
  });


  it("Test Case 5.1: Queue Succeeded Proposal via multi-sig and verify state transition", async () => {
    console.log(">>> Starting Test Case 5.1");
    try {
      await finaliseProposal(proposalPda);
    } catch (err) {
      console.error("Error during finalisation in Test Case 5.1:", err);
      throw err;
    }
    const beforeQueue = Math.floor(Date.now() / 1000);
    console.log("Timestamp before queueing:", beforeQueue);
    try {
      const txQueue = await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("queueProposal tx (5.1):", txQueue);
    } catch (err) {
      console.error("Error in queueProposal (5.1):", err);
      throw err;
    }
    const afterQueue = Math.floor(Date.now() / 1000);
    console.log("Timestamp after queueing:", afterQueue);
    const proposal = await program.account.proposal.fetch(proposalPda);
    console.log("Fetched proposal state (5.1):", proposal.state);
    const queuedAt = proposal.queuedAt.toNumber();
    // allow a timing offset of 1 second
    assert.isTrue(
      queuedAt >= beforeQueue - 1 && queuedAt <= afterQueue + 1,
      `queuedAt (${queuedAt}) should be within 1 second of the queueing timestamps`
    );
    const expectedReady = queuedAt + proposal.timelockDelay.toNumber();
    assert.equal(proposal.readyToExecuteAt.toNumber(), expectedReady, "ready_to_execute_at should equal queuedAt + timelock_delay");
    console.log("<<< Test Case 5.1 completed successfully.\n");
  });

  it("Test Case 5.2: Attempt queueing a non-Succeeded Proposal and expect failure", async () => {
    console.log(">>> Starting Test Case 5.2");
    // keep proposal as draft
    try {
      await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      assert.fail("Expected queueProposal to fail for a proposal not in Succeeded state");
    } catch (err: any) {
      console.error("Expected error in Test Case 5.2:", err);
      assert.include(err.message, "ConstraintRaw", "Expected ConstraintRaw error");
    }
    console.log("<<< Test Case 5.2 completed successfully.\n");
  });

  it("Test Case 5.3: Attempt queueing by unauthorised signer and expect failure", async () => {
    console.log(">>> Starting Test Case 5.3");
    await finaliseProposal(proposalPda);
    const attacker = web3.Keypair.generate();
    try {
      await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: attacker.publicKey, // unauthorised signer
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Expected queueProposal to fail due to unauthorised signer");
    } catch (err: any) {
      console.error("Expected error in Test Case 5.3:", err);
      assert.match(err.message, /has one constraint was violated|signature verification failed/i);
    }
    console.log("<<< Test Case 5.3 completed successfully.\n");
  });

  it("Test Case 5.4: Attempt queueing without required multi-sig signature and expect failure", async () => {
    console.log(">>> Starting Test Case 5.4");
    await finaliseProposal(proposalPda);
    try {
      await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([]) // omit smartWallet signature
        .rpc();
      assert.fail("Expected signature verification to fail");
    } catch (err: any) {
      console.error("Expected error in Test Case 5.4:", err);
      assert.match(err.message, /signature verification failed/i, "Expected signature verification error");
    }
    console.log("<<< Test Case 5.4 completed successfully.\n");
  });

  it("Test Case 5.5: Prevent re-queueing of an already queued proposal", async () => {
    console.log(">>> Starting Test Case 5.5");
    await finaliseProposal(proposalPda);
    // First queue 
    try {
      const tx1 = await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("First queueProposal tx (5.5):", tx1);
    } catch (err) {
      console.error("Error during first queueProposal in Test Case 5.5:", err);
      throw err;
    }
    // Second attempt should fail
    try {
      await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      assert.fail("Expected error for re-queueing an already queued proposal");
    } catch (err: any) {
      console.error("Expected error on second queue in Test Case 5.5:", err);
      assert.include(err.message, "ConstraintRaw", "Expected ConstraintRaw error");
    }
    console.log("<<< Test Case 5.5 completed successfully.\n");
  });


  it("Test Case 5.6: Queue multiple proposals independently and verify consistency", async () => {
    console.log(">>> Starting Test Case 5.6");
    await finaliseProposal(proposalPda);
    let secondProposalPda: web3.PublicKey;
    try {
      secondProposalPda = await createDraftProposal();
      console.log("Second draft proposal PDA:", secondProposalPda.toBase58());
      await finaliseProposal(secondProposalPda);
    } catch (err) {
      console.error("Error in finalizing second proposal in Test Case 5.6:", err);
      throw err;
    }
    try {
      const tx1 = await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("queueProposal tx for first proposal (5.6):", tx1);
      const tx2 = await program.methods.queueProposal()
        .accounts({
          governor: governorPda,
          proposal: secondProposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("queueProposal tx for second proposal (5.6):", tx2);
    } catch (err) {
      console.error("Error queueing proposals in Test Case 5.6:", err);
      throw err;
    }
    const firstProposal = await program.account.proposal.fetch(proposalPda);
    const secondProposal = await program.account.proposal.fetch(secondProposalPda);
    console.log("First proposal state (5.6):", firstProposal.state);
    console.log("Second proposal state (5.6):", secondProposal.state);
    assert.deepStrictEqual(firstProposal.state, { queued: {} }, "First proposal should be queued");
    assert.deepStrictEqual(secondProposal.state, { queued: {} }, "Second proposal should be queued");
    console.log("<<< Test Case 5.6 completed successfully.\n");
  });

});
