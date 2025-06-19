import { assert } from 'chai';

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import { IterativeDao } from '../target/types/iterative_dao';

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
  console.log(`Smart Wallet: ${smartWallet.publicKey.toBase58()}`);
  console.log(`Electorate: ${electorate.publicKey.toBase58()}`);
  [governorPda, bump] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from('governor'), smartWallet.publicKey.toBuffer()],
    program.programId
  );
  
  console.log(`Governor PDA: ${governorPda.toBase58()} with bump: ${bump}`);
  console.log("Initializing Governor with 4 args (threshold=60, timelock=3600, electoratePubkey, governanceMint)...");
  await program.methods
    .initGovernor(
      60,                       // vote_threshold
      new anchor.BN(3600),      // timelock_delay
      electorate.publicKey,     // electorate
      governanceMint            // governance_mint 
    )
    .accounts({
      governor: governorPda,
      smartWallet: smartWallet.publicKey,
      payer: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([smartWallet])
    .rpc();
  console.log("Governor initialised.");

  // add electorate as a voter so it can create proposals
  console.log("Adding electorate as a voter...");
  await program.methods
    .addVoter(electorate.publicKey, new anchor.BN(10)) // weight = 10
    .accounts({
      governor: governorPda,
      smartWallet: smartWallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([smartWallet])
    .rpc();
  console.log(`Electorate ${electorate.publicKey.toBase58()} added as voter with weight=10.\n`);
  console.log("--- Setup complete ---\n");
});


describe('Proposal Activation Tests', () => {
  let proposalPda: anchor.web3.PublicKey;
  let proposalBump: number;
  const votingPeriod = new anchor.BN(86400); // 24 hours

  // helper to create proposal index = 0
  const createProposal = async (): Promise<anchor.web3.PublicKey> => {
    const [pda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from('proposal'),
        governorPda.toBuffer(),
        new anchor.BN(0).toArrayLike(Buffer, 'le', 8)
      ],
      program.programId
    );
    // minimal instruction for proposal
    const mockInstruction: any = {
      program_id: program.programId,
      accounts: [
        {
          pubkey: provider.wallet.publicKey,
          is_signer: true,
          is_writable: true,
        },
      ],
      data: Buffer.from([]),
    };

    // create proposal using electorate as proposer
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

  beforeEach(async () => {
    proposalPda = await createProposal();
  });

  it('Test Case 3.1: Activate Proposal as authorised electorate via multi-sig and verify state transition', async () => {
    console.log(">>> Starting Test Case 3.1: Activate Proposal as authorised electorate via multi-sig and verify state transition");
    try {
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      const proposal = await program.account.proposal.fetch(proposalPda);
      assert.deepStrictEqual(proposal.state, { active: {} });
      console.log("<<< Test Case 3.1 completed successfully.\n");
    } catch (err: any) {
      console.error("Error in Test Case 3.1:", err);
      throw err;
    }
  });

  it('Test Case 3.2: Ensure voting period is set through consensus upon activation', async () => {
    console.log(">>> Starting Test Case 3.2: Ensure voting period is set through consensus upon activation");
    try {
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      const proposal = await program.account.proposal.fetch(proposalPda);
      assert.equal(proposal.votingPeriod.toNumber(), votingPeriod.toNumber());
      console.log("<<< Test Case 3.2 completed successfully.\n");
    } catch (err: any) {
      console.error("Error in Test Case 3.2:", err);
      throw err;
    }
  });

  it('Test Case 3.3: Attempt activation by unauthorised members and expect failure', async () => {
    console.log(">>> Starting Test Case 3.3: Attempt activation by unauthorised members and expect failure");
    const attacker = anchor.web3.Keypair.generate();
    try {
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: attacker.publicKey, // Unauthorised smart wallet
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail('Expected the transaction to fail due to unauthorised smart wallet.');
    } catch (err: any) {
      console.log(`Error Message in Test Case 3.3: ${err.message}`);
      assert.match(
        err.message,
        /has one constraint was violated|signature verification failed/i,
        'Expected a has_one constraint or signature verification error.'
      );
      console.log("<<< Test Case 3.3 completed successfully.\n");
    }
  });

  it('Test Case 3.4: Try activating an already active proposal and expect failure', async () => {
    console.log(">>> Starting Test Case 3.4: Try activating an already active proposal and expect failure");
    try {
      // first activation 
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();

      // reactivation should fail
      try {
        await program.methods.activateProposal(votingPeriod)
          .accounts({
            governor: governorPda,
            proposal: proposalPda,
            smartWallet: smartWallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([smartWallet])
          .rpc();
        assert.fail('Should have failed because the proposal is already active');
      } catch (err: any) {
        assert.include(
          err.message,
          'ConstraintRaw',
          'Expected InvalidStateTransition error'
        );
      }
      console.log("<<< Test Case 3.4 completed successfully.\n");
    } catch (err: any) {
      console.error("Error in Test Case 3.4:", err);
      throw err;
    }
  });

  it('Test Case 3.5: Validate timelock delay application based on governance parameters', async () => {
    console.log(">>> Starting Test Case 3.5: Validate timelock delay application based on governance parameters");
    try {
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      const governor = await program.account.governor.fetch(governorPda);
      const proposal = await program.account.proposal.fetch(proposalPda);
      assert.equal(
        proposal.timelockDelay.toNumber(), 
        governor.timelockDelay.toNumber(),
        "timelockDelay in proposal should match governor's timelock_delay"
      );
      console.log("<<< Test Case 3.5 completed successfully.\n");
    } catch (err: any) {
      console.error("Error in Test Case 3.5:", err);
      throw err;
    }
  });

  it('Test Case 3.6: Attempt activation without required multi-sig approvals and expect failure', async () => {
    console.log(">>> Starting Test Case 3.6: Attempt activation without required multi-sig approvals and expect failure");
    try {
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([]) // No signers provided
        .rpc();
      assert.fail('Expected the transaction to fail due to missing multi-sig approvals.');
    } catch (err: any) {
      console.log(`Error Message in Test Case 3.6: ${err.message}`);
      assert.match(
        err.message,
        /signature verification failed/i,
        'Expected signature verification failure.'
      );
      console.log("<<< Test Case 3.6 completed successfully.\n");
    }
  });

  it('Test Case 3.7: Ensure state determination aligns with current time and vote data through consensus', async () => {
    console.log(">>> Starting Test Case 3.7: Ensure state determination aligns with current time and vote data through consensus");
    try {
      const beforeActivation = Math.floor(Date.now() / 1000);
      console.log("Timestamp before activation:", beforeActivation);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await program.methods.activateProposal(votingPeriod)
        .accounts({
          governor: governorPda,
          proposal: proposalPda,
          smartWallet: smartWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([smartWallet])
        .rpc();
      const proposal = await program.account.proposal.fetch(proposalPda);
      const afterActivation = Math.floor(Date.now() / 1000);
      console.log("Timestamp after activation:", afterActivation);
      console.log("Proposal activatedAt timestamp:", proposal.activatedAt.toNumber());
      assert.isAtLeast(proposal.activatedAt.toNumber(), beforeActivation, "activatedAt is too early");
      assert.isAtMost(proposal.activatedAt.toNumber(), afterActivation, "activatedAt is too late");
      console.log("<<< Test Case 3.7 completed successfully.\n");
    } catch (err: any) {
      console.error("Error in Test Case 3.7:", err);
      throw err;
    }
  });
});
