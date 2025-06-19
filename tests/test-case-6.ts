import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

describe('Vote Creation Tests (User Story 6)', () => {

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IterativeDao as Program<IterativeDao>;
  let smartWallet: anchor.web3.Keypair;
  let electorate: anchor.web3.Keypair;
  let governorPda: anchor.web3.PublicKey;
  let proposalPda: anchor.web3.PublicKey;
  let bump: number;
  const governanceMint = anchor.web3.Keypair.generate().publicKey;
  const votingPeriod = new anchor.BN(86400);
  const mockInstruction = {
    programId: program.programId,
    accounts: [],
    data: Buffer.from([]),
  };

  const createDraftProposal = async () => {
    const [pda] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from('proposal'),
        governorPda.toBuffer(),
        new anchor.BN(0).toArrayLike(Buffer, 'le', 8),
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
    return pda;
  };

  const activateProposal = async (proposalPubkey: anchor.web3.PublicKey) => {
    await program.methods
      .activateProposal(votingPeriod)
      .accounts({
        governor: governorPda,
        proposal: proposalPubkey,
        smartWallet: smartWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet])
      .rpc();
  };
  const findVotePda = async (
    proposalPubkey: anchor.web3.PublicKey,
    voterPubkey: anchor.web3.PublicKey
  ) => {
    const [pda] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from('vote'),
        proposalPubkey.toBuffer(),
        voterPubkey.toBuffer(),
      ],
      program.programId
    );
    return pda;
  };

  beforeEach(async () => {
    smartWallet = anchor.web3.Keypair.generate();
    electorate = anchor.web3.Keypair.generate();
    [governorPda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('governor'), smartWallet.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initGovernor(
        60,                      // voteThreshold
        new anchor.BN(3600),     // timelock
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
    await program.methods
      .addVoter(electorate.publicKey, new anchor.BN(10)) // weight=10
      .accounts({
        governor: governorPda,
        smartWallet: smartWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet])
      .rpc();
    proposalPda = await createDraftProposal();
    await activateProposal(proposalPda);
  });


  it('Test Case 6.1: Create Vote record with valid Proposal and Voter via multi-sig and verify initialisation', async () => {
    const votePda = await findVotePda(proposalPda, electorate.publicKey);
    await program.methods
      .createVote()
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
    const voteAccount = await program.account.vote.fetch(votePda);
    assert.equal(
      voteAccount.proposal.toBase58(),
      proposalPda.toBase58(),
      'Vote linked to correct proposal'
    );
    assert.equal(
      voteAccount.voter.toBase58(),
      electorate.publicKey.toBase58(),
      'Vote linked to correct voter'
    );
  });


  it('Test Case 6.2: Ensure linkage to Proposal and Voter securely through multi-sig', async () => {
    const votePda = await findVotePda(proposalPda, electorate.publicKey);
    await program.methods
      .createVote()
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
    const vote = await program.account.vote.fetch(votePda);
    assert.deepStrictEqual(vote.state, { pending: {} }, 'Vote must be Pending');
    assert.equal(
      vote.voter.toBase58(),
      electorate.publicKey.toBase58(),
      'Voter must match electorate key'
    );
  });

  it('Test Case 6.3: Attempt Vote creation by unauthorised members via multi-sig and expect failure', async () => {
    const attacker = anchor.web3.Keypair.generate();
    const votePda = await findVotePda(proposalPda, attacker.publicKey);
    try {
      await program.methods
        .createVote()
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          vote: votePda,
          voter: attacker.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet, attacker])
        .rpc();
      assert.fail('Expected unauthorised voter error');
    } catch (err: any) {
      console.log('Caught error message (6.4):', err.message);
      assert.match(
        err.message,
        /UnauthorisedVoter|constraint was violated/i,
        'Expected unauthorised voter error'
      );
    }
  });


  it('Test Case 6.4: Prevent Vote creation with invalid Proposal/Voter links and expect failure', async () => {
    const invalidProposal = anchor.web3.Keypair.generate().publicKey;
    const votePda = await findVotePda(invalidProposal, electorate.publicKey);
    try {
      await program.methods
        .createVote()
        .accounts({
          governor: governorPda,
          proposal: invalidProposal,
          vote: votePda,
          voter: electorate.publicKey,
          smartWallet: smartWallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet, electorate])
        .rpc();
      assert.fail('Expected an invalid reference error');
    } catch (err: any) {
      console.log('Caught error message (6.5):', err.message);
      assert.match(
        err.message,
        /account does not exist|seeds constraint was violated|InvalidStateTransition|AccountNotInitialized/i,
        'Expected invalid reference or seeds constraint error'
      );
    }
  });

  it('Test Case 6.5: Validate Vote record initialises with Pending state', async () => {
    const votePda = await findVotePda(proposalPda, electorate.publicKey);
    await program.methods
      .createVote()
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
    const vote = await program.account.vote.fetch(votePda);
    assert.deepStrictEqual(vote.state, { pending: {} }, 'Vote must be Pending');
  });


  it('Test Case 6.6: Manage multiple Votes through multi-sig and ensure correct tracking', async () => {
    // create second voter
    const secondVoter = anchor.web3.Keypair.generate();
    // add secondVoter 
    await program.methods
      .addVoter(secondVoter.publicKey, new anchor.BN(5))
      .accounts({
        governor: governorPda,
        smartWallet: smartWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet])
      .rpc();
    // vote 1 
    const votePda1 = await findVotePda(proposalPda, electorate.publicKey);
    await program.methods
      .createVote()
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda1,
        voter: electorate.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, electorate])
      .rpc();
    // second voter
    const votePda2 = await findVotePda(proposalPda, secondVoter.publicKey);
    await program.methods
      .createVote()
      .accounts({
        governor: governorPda,
        proposal: proposalPda,
        vote: votePda2,
        voter: secondVoter.publicKey,
        smartWallet: smartWallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([smartWallet, secondVoter])
      .rpc();
    const vote1 = await program.account.vote.fetch(votePda1);
    const vote2 = await program.account.vote.fetch(votePda2);
    assert.equal(vote1.voter.toBase58(), electorate.publicKey.toBase58(), "Vote #1 by electorate");
    assert.equal(vote2.voter.toBase58(), secondVoter.publicKey.toBase58(), "Vote #2 by secondVoter");
  });

  it('Test Case 6.7: Verify space allocation for Vote accounts', async () => {
    const votePda = await findVotePda(proposalPda, electorate.publicKey);
    await program.methods
      .createVote()
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
    const vote = await program.account.vote.fetch(votePda);
    assert.ok(vote, 'Vote created => space is sufficient');
  });

  
  it('Test Case 6.8: Ensure Vote records are correctly linked to Proposals', async () => {
    const votePda = await findVotePda(proposalPda, electorate.publicKey);
    await program.methods
      .createVote()
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
    const vote = await program.account.vote.fetch(votePda);
    assert.equal(
      vote.proposal.toBase58(),
      proposalPda.toBase58(),
      'Vote is linked to the correct proposal'
    );
  });

  it('Test Case 6.9: Prevent duplicate Vote records for same member and Proposal through multi-sig approvals', async () => {
    const votePda = await findVotePda(proposalPda, electorate.publicKey);
    // first creation
    await program.methods
      .createVote()
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
    // second creation - same seeds = collision
    try {
      await program.methods
        .createVote()
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
      assert.fail('Expected duplicate creation error');
    } catch (err: any) {
      console.log('Caught error message (6.9):', err.message);
      assert.match(
        err.message,
        /address in use|already in use|seeds constraint/i,
        'Expected a duplicate creation error'
      );
    }
  });
});