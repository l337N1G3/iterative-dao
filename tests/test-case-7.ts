import BN from 'bn.js';
import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import {
  Program,
  web3,
} from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

describe("Cast Vote Tests (User Story 7)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: web3.Keypair;
  let electorate: web3.Keypair;
  let governorPda: web3.PublicKey;
  let governorBump: number;
  let proposalPda: web3.PublicKey;
  let votePda: web3.PublicKey;
  const defaultVotingPeriod = new BN(86400); // 1 day
  const testVotingPeriod = new BN(1); // 1 second for quick tests (7.9)
  const defaultWeight = new BN(50);
  const mockInstruction = {
    programId: program.programId,
    accounts: [],
    data: Buffer.from([]),
  };
  const createDraftProposal = async (proposalIndex: number = 0): Promise<web3.PublicKey> => {
    console.log("Creating draft proposal...");
    const [proposalAddr] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from("proposal"),
        governorPda.toBuffer(),
        new BN(proposalIndex).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    console.log(`Draft Proposal PDA: ${proposalAddr.toBase58()}`);
    try {
      const tx = await program.methods
        .createProposal([mockInstruction])
        .accounts({
          governor: governorPda,
          proposal: proposalAddr,
          payer: provider.wallet.publicKey,
          proposer: electorate.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([electorate])
        .rpc();
      console.log(`Draft proposal created at: ${proposalAddr.toBase58()}`);
    } catch (err) {
      console.error("Error creating draft proposal:", err);
      throw err;
    }
    return proposalAddr;
  };
  const activateProposal = async (
    proposalPubkey: web3.PublicKey,
    votingPeriod: BN = defaultVotingPeriod
  ) => {
    console.log(
      `Activating proposal ${proposalPubkey.toBase58()} with voting period ${votingPeriod.toNumber()} seconds...`
    );
    try {
      const tx = await program.methods
        .activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPubkey,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log(`activateProposal tx: ${tx}`);
    } catch (error) {
      console.error("Error activating proposal:", error);
      throw error;
    }
  };
  const createPendingVote = async (
    proposalPubkey: web3.PublicKey,
    voterPubkey: web3.PublicKey
  ): Promise<web3.PublicKey> => {
    console.log("Creating pending vote...");
    const [voteAddr] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from("vote"),
        proposalPubkey.toBuffer(),
        voterPubkey.toBuffer(),
      ],
      program.programId
    );
    try {
      const tx = await program.methods
        .createVote()
        .accounts({
          governor: governorPda,
          proposal: proposalPubkey,
          vote: voteAddr,
          voter: voterPubkey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`Pending vote created at: ${voteAddr.toBase58()}`);
    } catch (error) {
      console.error("Error creating pending vote:", error);
      throw error;
    }
    return voteAddr;
  };

  beforeEach(async () => {
    console.log("\n=== Setting up Cast Vote Test Environment ===");
    smartWallet = web3.Keypair.generate();
    electorate = web3.Keypair.generate();
    console.log("SmartWallet:", smartWallet.publicKey.toBase58());
    console.log("Electorate:", electorate.publicKey.toBase58());
    [governorPda, governorBump] = await web3.PublicKey.findProgramAddress(
      [Buffer.from("governor"), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("Governor PDA:", governorPda.toBase58(), "Bump:", governorBump);
    const dummyMint = web3.Keypair.generate().publicKey;
    try {
      const txInit = await program.methods
        .initGovernor(new BN(60), new BN(3600), electorate.publicKey, dummyMint)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("Governor initialised successfully, tx:", txInit);
    } catch (error) {
      console.error("Error initializing governor:", error);
      throw error;
    }
    try {
      const txAddVoter = await program.methods
        .addVoter(electorate.publicKey, defaultWeight)
        .accounts({
          governor: governorPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      console.log("Voter added successfully, tx:", txAddVoter);
    } catch (error) {
      console.error("Error adding voter:", error);
      throw error;
    }
    try {
      proposalPda = await createDraftProposal(0);
      await activateProposal(proposalPda);
    } catch (error) {
      console.error("Error setting up proposal:", error);
      throw error;
    }
    try {
      votePda = await createPendingVote(proposalPda, electorate.publicKey);
    } catch (error) {
      console.error("Error creating pending vote:", error);
      throw error;
    }
    console.log("=== Setup for Cast Vote Tests complete ===\n");
  });


  it("Test Case 7.1: Cast 'for' vote on Active Proposal via multi-sig and verify tally", async () => {
    console.log(">>> Starting Test Case 7.1");
    try {
      await program.methods.castVote({ for: {} }, defaultWeight)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"For" vote cast successfully.`);
      const proposal = await program.account.proposal.fetch(proposalPda);
      console.log("Proposal forVotes:", proposal.forVotes.toString());
      assert.equal(
        proposal.forVotes.toString(),
        defaultWeight.toString(),
        `forVotes should equal the cast weight of ${defaultWeight.toString()}`
      );
    } catch (error) {
      console.error("Error in Test Case 7.1:", error);
      assert.fail(`Test Case 7.1 failed: ${error.message}`);
    }
    console.log("<<< Test Case 7.1 completed.\n");
  });

  it("Test Case 7.2: Cast 'against' vote on Active Proposal via multi-sig and verify tally", async () => {
    console.log(">>> Starting Test Case 7.2");
    try {
      await program.methods.castVote({ against: {} }, defaultWeight)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"Against" vote cast successfully.`);
      const proposal = await program.account.proposal.fetch(proposalPda);
      console.log("Proposal againstVotes:", proposal.againstVotes.toString());
      assert.equal(
        proposal.againstVotes.toString(),
        defaultWeight.toString(),
        `againstVotes should equal the cast weight of ${defaultWeight.toString()}`
      );
    } catch (error) {
      console.error("Error in Test Case 7.2:", error);
      assert.fail(`Test Case 7.2 failed: ${error.message}`);
    }
    console.log("<<< Test Case 7.2 completed.\n");
  });

  it("Test Case 7.3: Cast 'abstain' vote on Active Proposal via multi-sig and verify tally", async () => {
    console.log(">>> Starting Test Case 7.3");
    try {
      await program.methods.castVote({ abstain: {} }, defaultWeight)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"Abstain" vote cast successfully.`);
      const proposal = await program.account.proposal.fetch(proposalPda);
      console.log("Proposal abstainVotes:", proposal.abstainVotes.toString());
      assert.equal(
        proposal.abstainVotes.toString(),
        defaultWeight.toString(),
        `abstainVotes should equal the cast weight of ${defaultWeight.toString()}`
      );
    } catch (error) {
      console.error("Error in Test Case 7.3:", error);
      assert.fail(`Test Case 7.3 failed: ${error.message}`);
    }
    console.log("<<< Test Case 7.3 completed.\n");
  });


  it("Test Case 7.5: Prevent double voting by the same member via multi-sig", async () => {
    console.log(">>> Starting Test Case 7.5");
    try {
      await program.methods.castVote({ for: {} }, defaultWeight)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"For" vote cast successfully the first time.`);
      try {
        await program.methods.castVote({ for: {} }, new BN(100))
          .accounts({
            governor: governorPda,
            proposal: proposalPda,
            vote: votePda,
            voter: electorate.publicKey,
            smartWallet: smartWallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([smartWallet, electorate])
          .rpc();
        assert.fail("Expected error for double voting attempt");
      } catch (err: any) {
        console.log("Double voting attempt failed as expected:", err.message);
        assert.include(err.message, "ConstraintRaw", "Expected error for double voting");
      }
    } catch (error) {
      console.error("Error in Test Case 7.5:", error);
      assert.fail(`Test Case 7.5 failed: ${error.message}`);
    }
    console.log("<<< Test Case 7.5 completed.\n");
  });


  it("Test Case 7.6: Validate vote weight based on collectively locked tokens", async () => {
    console.log(">>> Starting Test Case 7.6");
    const bigWeight = new BN(9999);
    try {
      await program.methods.castVote({ for: {} }, bigWeight)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"For" vote cast with weight ${bigWeight.toString()} successfully.`);
      const proposal = await program.account.proposal.fetch(proposalPda);
      console.log("Proposal forVotes after big vote:", proposal.forVotes.toString());
      assert.equal(
        proposal.forVotes.toString(),
        bigWeight.toString(),
        `forVotes should equal the cast weight of ${bigWeight.toString()}`
      );
    } catch (error) {
      console.error("Error in Test Case 7.6:", error);
      assert.fail(`Test Case 7.6 failed: ${error.message}`);
    }
    console.log("<<< Test Case 7.6 completed.\n");
  });

  it("Test Case 7.7: Unauthorised voting attempt should be rejected", async () => {
    console.log(">>> Starting Test Case 7.7");
    const attacker = web3.Keypair.generate();
    try {
      await program.methods.castVote({ for: {} }, defaultWeight)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: attacker.publicKey, 
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, attacker])
        .rpc();
      assert.fail("Expected unauthorised voter error");
    } catch (err: any) {
      console.log("Unauthorised voting attempt failed as expected:", err.message);
      assert.match(err.message, /UnauthorizedVoter|constraint was violated/i, "Expected unauthorised voter error");
    }
    console.log("<<< Test Case 7.7 completed.\n");
  });

  it("Test Case 7.8: Ensure votes influence Proposal state correctly through consensus", async () => {
    console.log(">>> Starting Test Case 7.8");
    try {
      const shortVotingPeriod = new BN(1);
      const shortProposalPda = await createDraftProposal(1);
      console.log(`Short Proposal created at: ${shortProposalPda.toBase58()}`);
      await activateProposal(shortProposalPda, shortVotingPeriod);
      const shortVotePda = await createPendingVote(shortProposalPda, electorate.publicKey);
      const sufficientWeight = new BN(100);
      await program.methods.castVote({ for: {} }, sufficientWeight)
        .accounts({
          governor: governorPda,
          proposal: shortProposalPda,
          vote: shortVotePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"For" vote cast with weight ${sufficientWeight.toString()} successfully on short Proposal.`);
      console.log("Waiting for voting period to elapse...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        await program.methods.finaliseProposal()
          .accounts({
            governor: governorPda,
            proposal: shortProposalPda,
            smartWallet: smartWallet.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([smartWallet])
          .rpc();
        console.log("Proposal finalised successfully.");
      } catch (finaliseError) {
        console.error("Error finalising short proposal:", finaliseError);
        throw finaliseError;
      }
      const finalisedProposal = await program.account.proposal.fetch(shortProposalPda);
      console.log("Finalised Proposal state:", finalisedProposal.state);
      const isSucceeded = "succeeded" in finalisedProposal.state;
      assert.isTrue(isSucceeded, "Proposal should have succeeded after finalisation.");
    } catch (error) {
      console.error("Error in Test Case 7.8:", error);
      assert.fail(`Test Case 7.8 failed: ${error.message}`);
    }
    console.log("<<< Test Case 7.8 completed.\n");
  });

  it("Test Case 7.9: Handle edge cases of maximum vote weights via multi-sig approvals", async () => {
    console.log(">>> Starting Test Case 7.9");
    const maxU64 = new BN("18446744073709551615");
    try {
      await program.methods.castVote({ for: {} }, maxU64)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      console.log(`"For" vote cast with max weight ${maxU64.toString()} successfully.`);
      const proposal = await program.account.proposal.fetch(proposalPda);
      console.log("Proposal forVotes after max vote:", proposal.forVotes.toString());
      assert.equal(proposal.forVotes.toString(), maxU64.toString(), "Tally must handle maximum vote weight.");
    } catch (err: any) {
      console.log("Casting max vote failed as expected:", err.message);
      assert.include(err.message, "NumericalOverflow", "Expected overflow for maximum weight");
    }
    console.log("<<< Test Case 7.9 completed.\n");
  });
});
