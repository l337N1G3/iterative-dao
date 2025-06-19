import BN from 'bn.js';
import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

describe("Set Vote Tests (User Story 8)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: anchor.web3.Keypair;
  let electorate: anchor.web3.Keypair;
  let governorPda: anchor.web3.PublicKey;
  let proposalPda: anchor.web3.PublicKey;
  let votePda: anchor.web3.PublicKey;
  let bump: number;
  const governanceMint = anchor.web3.Keypair.generate().publicKey;
  const votingPeriod = new anchor.BN(86400);
  const mockInstruction = {
    programId: program.programId,
    accounts: [],
    data: Buffer.from([]),
  };
  const setupActiveProposalAndVote = async () => {
    const [pda] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("proposal"),
        governorPda.toBuffer(),
        new anchor.BN(0).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    await program.methods
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
    await program.methods
      .activateProposal(votingPeriod)
      .accounts({
        governor: governorPda,
        proposal: pda,
        smartWallet: smartWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet])
      .rpc();
    const [vpda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("vote"), pda.toBuffer(), electorate.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .createVote()
      .accounts({
        governor: governorPda,
        proposal: pda,
        vote: vpda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    return { proposalPda: pda, votePda: vpda };
  };

  beforeEach(async () => {
    smartWallet = anchor.web3.Keypair.generate();
    electorate = anchor.web3.Keypair.generate();
    [governorPda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("governor"), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initGovernor(
        60,                     // threshold
        new anchor.BN(3600),    // timelock
        electorate.publicKey,   // electorate
        governanceMint          // dummy mint
      )
      .accounts({
        governor: governorPda,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet])
      .rpc();
    // add electorate, weight=100
    await program.methods
      .addVoter(electorate.publicKey, new anchor.BN(100))
      .accounts({
        governor: governorPda,
        smartWallet: smartWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet])
      .rpc();
    const result = await setupActiveProposalAndVote();
    proposalPda = result.proposalPda;
    votePda = result.votePda;
  });

  it('Test Case 8.1: Set Vote side to "for" via multi-sig; verify Proposal tallies', async () => {
    await program.methods
      .setVote({ for: {} }) 
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    const proposal = await program.account.proposal.fetch(proposalPda);
    const forVotesBn = new BN(proposal.forVotes.toString());
    assert.ok(
      forVotesBn.eq(new BN(100)),
      `Expected forVotes=100; got ${forVotesBn.toString()}`
    );
  });

  it('Test Case 8.2: Set Vote side to "against" and ensure accurate recording', async () => {
    await program.methods
      .setVote({ for: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    await program.methods
      .setVote({ against: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);

    const forBn = new BN(proposal.forVotes.toString());
    assert.ok(forBn.eq(new BN(0)), `Expected for=0, got ${forBn}`);
    const againstBn = new BN(proposal.againstVotes.toString());
    assert.ok(againstBn.eq(new BN(100)), `Expected against=100, got ${againstBn}`);
  });

  it('Test Case 8.3: Abstain from voting via multi-sig and confirm quorum impact', async () => {
    await program.methods
      .setVote({ against: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    await program.methods
      .setVote({ abstain: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    const againstBn = new BN(proposal.againstVotes.toString());
    assert.ok(againstBn.eq(new BN(0)), "old against removed => 0");
    const abstainBn = new BN(proposal.abstainVotes.toString());
    assert.ok(abstainBn.eq(new BN(100)), "abstain => 100");
  });

  it('Test Case 8.4: Attempt setting Vote by unauthorised electorate members => expect failure', async () => {
    const attacker = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .setVote({ for: {} })
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: attacker.publicKey, // mismatch
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet, attacker])
        .rpc();
      assert.fail("Expected unauthorised vote setting to fail");
    } catch (err: any) {
      assert.match(
        err.message,
        /UnauthorizedVoter|constraint was violated/i,
        "Expect mismatch voter constraint error"
      );
    }
  });

  it('Test Case 8.6: Prevent setting Vote with invalid side => expect "unable to infer src variant"', async () => {
    try {
      // 
      await program.methods
        .setVote({ someInvalidSide: {} })
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      assert.fail("Expected invalid side error");
    } catch (err: any) {
      assert.match(
        err.message,
        /unable to infer src variant/i,
        "Expected invalid side variant error"
      );
    }
  });

  it('Test Case 8.7: Update existing Vote => ensure tallies are adjusted', async () => {
    await program.methods
      .setVote({ for: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    await program.methods
      .setVote({ for: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    const proposal = await program.account.proposal.fetch(proposalPda);
    const forVotesBn = new BN(proposal.forVotes.toString());
    assert.ok(
      forVotesBn.eq(new BN(100)), 
      `Tally should be updated from old 100 => new. Found: ${forVotesBn.toString()}`
    );
  });

  it('Test Case 8.9: Validate vote weight calculation based on membership data', async () => {
    await program.methods
      .setVote({ for: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    const proposal = await program.account.proposal.fetch(proposalPda);
    const forVotesBn = new BN(proposal.forVotes.toString());
    assert.ok(
      forVotesBn.eq(new BN(100)),
      `Expected for=100; got ${forVotesBn.toString()}`
    );
  });

  it('Test Case 8.10: Prevent double-counting by correctly updating previous Vote', async () => {
    await program.methods
      .setVote({ for: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    await program.methods
      .setVote({ for: {} })
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    const proposal = await program.account.proposal.fetch(proposalPda);
    const forVotesBn = new BN(proposal.forVotes.toString());
    assert.ok(
      forVotesBn.eq(new BN(100)),
      `Double counting prevented => net=100, got ${forVotesBn}`
    );
  });
});