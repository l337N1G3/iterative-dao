use anchor_lang::prelude::*;
use crate::{
    contexts::{InitGovernor, AddVoter},
    errors::ErrorCode,
    events::GovernorCreated,
    state::VoterInfo,
};

pub fn init_governor(
    ctx: Context<InitGovernor>,
    vote_threshold: u8,
    timelock_delay: i64,
    electorate: Pubkey,
    governance_mint: Pubkey,
) -> Result<()> {
    let governor = &mut ctx.accounts.governor;
    require!(vote_threshold <= 100, ErrorCode::InvalidVoteThreshold);
    require!(timelock_delay >= 0, ErrorCode::InvalidTimelockDelay);

    governor.vote_threshold = vote_threshold;
    governor.timelock_delay = timelock_delay;
    governor.smart_wallet = ctx.accounts.smart_wallet.key();
    governor.electorate = electorate;
    governor.is_initialised = true;
    governor.proposal_count = 0;
    governor.voters = Vec::new();
    governor.governance_mint = governance_mint;
    governor.padding = [0u8; 2];

    emit!(GovernorCreated {
        governor: governor.key(),
        smart_wallet: governor.smart_wallet,
        electorate: governor.electorate,
        vote_threshold,
        timelock_delay,
    });
    Ok(())
}

pub fn add_voter(ctx: Context<AddVoter>, new_voter: Pubkey, weight: u64) -> Result<()> {
    let governor = &mut ctx.accounts.governor;
    require!(
        !governor.voters.iter().any(|v| v.pubkey == new_voter),
        ErrorCode::DuplicateVoter
    );
    governor.voters.push(VoterInfo { pubkey: new_voter, weight });
    Ok(())
}
