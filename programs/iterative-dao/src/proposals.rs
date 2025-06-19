use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use crate::{
    contexts::{CreateProposal, ActivateProposal, CancelProposal, QueueProposal, FinaliseProposal, ExecuteProposal},
    errors::ErrorCode,
    events::{ProposalActivated, ProposalCanceled, ProposalQueued},
    state::{Governor, Proposal},
    enums::ProposalState,
};

pub fn create_proposal(
    ctx: Context<CreateProposal>,
    instructions: Vec<crate::state::ProposalInstruction>,
) -> Result<()> {
    let governor = &mut ctx.accounts.governor;
    let proposal = &mut ctx.accounts.proposal;

    require!(!instructions.is_empty(), ErrorCode::InvalidInstructions);

    let proposer_key = ctx.accounts.proposer.key();
    require!(
        governor.voters.iter().any(|v| v.pubkey == proposer_key),
        ErrorCode::UnauthorisedVoter
    );

    proposal.governor = governor.key();
    proposal.proposer = proposer_key;
    proposal.instructions = instructions;
    proposal.state = ProposalState::Draft;
    proposal.proposal_id = governor.proposal_count;
    proposal.for_votes = 0;
    proposal.against_votes = 0;
    proposal.abstain_votes = 0;
    proposal.activated_at = 0;
    proposal.voting_period = 0;
    proposal.timelock_delay = governor.timelock_delay;
    proposal.queued_at = 0;
    proposal.ready_to_execute_at = 0;
    proposal.padding = [0u8; 3];

    governor.proposal_count += 1;
    Ok(())
}

pub fn activate_proposal(ctx: Context<ActivateProposal>, voting_period: i64) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.state == ProposalState::Draft, ErrorCode::InvalidStateTransition);
    require!(voting_period > 0, ErrorCode::InvalidVotingPeriod);

    let now = Clock::get()?.unix_timestamp;
    proposal.state = ProposalState::Active;
    proposal.activated_at = now;
    proposal.voting_period = voting_period;
    proposal.timelock_delay = ctx.accounts.governor.timelock_delay;

    emit!(ProposalActivated {
        proposal: proposal.key(),
        activated_at: proposal.activated_at,
        voting_period: proposal.voting_period,
        timelock_delay: proposal.timelock_delay,
    });
    Ok(())
}

pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.state == ProposalState::Draft, ErrorCode::InvalidStateTransition);
    require!(
        proposal.proposer == ctx.accounts.proposer.key(),
        ErrorCode::UnauthorisedCancellation
    );

    proposal.state = ProposalState::Canceled;
    emit!(ProposalCanceled {
        proposal: proposal.key(),
        canceled_by: ctx.accounts.proposer.key(),
        canceled_at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn queue_proposal(ctx: Context<QueueProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.state == ProposalState::Succeeded, ErrorCode::InvalidStateTransition);

    let now = Clock::get()?.unix_timestamp;
    proposal.queued_at = now;
    proposal.ready_to_execute_at = now
        .checked_add(proposal.timelock_delay)
        .ok_or(ErrorCode::InvalidTimelockDelay)?;
    proposal.state = ProposalState::Queued;

    emit!(ProposalQueued {
        proposal: proposal.key(),
        queued_at: proposal.queued_at,
        ready_to_execute_at: proposal.ready_to_execute_at,
    });
    Ok(())
}

pub fn finalise_proposal(ctx: Context<FinaliseProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let governor = &ctx.accounts.governor;

    require!(proposal.state == ProposalState::Active, ErrorCode::InvalidStateTransition);

    let now = Clock::get()?.unix_timestamp;
    let end_time = proposal
        .activated_at
        .checked_add(proposal.voting_period)
        .ok_or(ErrorCode::NumericalOverflow)?;
    require!(now >= end_time, ErrorCode::VotingPeriodActive);

    let total_cast = proposal
        .for_votes
        .checked_add(proposal.against_votes)
        .and_then(|v| v.checked_add(proposal.abstain_votes))
        .ok_or(ErrorCode::NumericalOverflow)?;

    if total_cast > 0 {
        let for_percent = (proposal.for_votes as u128)
            .checked_mul(100)
            .ok_or(ErrorCode::NumericalOverflow)?
            / (total_cast as u128);
        proposal.state = if for_percent >= governor.vote_threshold as u128 {
            ProposalState::Succeeded
        } else {
            ProposalState::Rejected
        };
    } else {
        proposal.state = ProposalState::Rejected;
    }
    Ok(())
}

pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.state == ProposalState::Queued, ErrorCode::InvalidStateTransition);

    let now = Clock::get()?.unix_timestamp;
    require!(now >= proposal.ready_to_execute_at, ErrorCode::TimelockNotExpired);

    proposal.state = ProposalState::Executed;
    Ok(())
}
