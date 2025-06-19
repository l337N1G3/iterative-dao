use anchor_lang::prelude::*;
use crate::{
    contexts::{CreateVote, CastVote, SetVote},
    errors::ErrorCode,
    events::{VoteCreateEvent, VoteSetEvent},
    state::{Governor, Proposal, Vote},
    enums::{VoteSide, VoteState, ProposalState},
};

pub fn create_vote(ctx: Context<CreateVote>) -> Result<()> {
    let governor = &ctx.accounts.governor;
    let proposal = &ctx.accounts.proposal;
    let vote = &mut ctx.accounts.vote;
    let voter_key = ctx.accounts.voter.key();

    require!(
        governor.voters.iter().any(|vi| vi.pubkey == voter_key),
        ErrorCode::UnauthorisedVoter
    );
    require!(proposal.state == ProposalState::Active, ErrorCode::InvalidStateTransition);

    vote.proposal = proposal.key();
    vote.voter = voter_key;
    vote.side = VoteSide::Abstain {};
    vote.weight = 0;
    vote.state = VoteState::Pending;
    vote.padding = [0u8; 6];

    emit!(VoteCreateEvent {
        vote: vote.key(),
        proposal: proposal.key(),
        voter: vote.voter,
        state: vote.state.clone(),
    });
    Ok(())
}

pub fn cast_vote(ctx: Context<CastVote>, side: VoteSide, weight: u64) -> Result<()> {
    let governor = &ctx.accounts.governor;
    let proposal = &mut ctx.accounts.proposal;
    let vote = &mut ctx.accounts.vote;
    let voter_key = ctx.accounts.voter.key();

    require!(
        governor.voters.iter().any(|vi| vi.pubkey == voter_key),
        ErrorCode::UnauthorisedVoter
    );
    require!(proposal.state == ProposalState::Active, ErrorCode::InvalidStateTransition);
    require!(vote.state == VoteState::Pending, ErrorCode::InvalidStateTransition);

    vote.side = side.clone();
    vote.weight = weight;
    vote.state = VoteState::Cast;

    match side {
        VoteSide::For {} => {
            proposal.for_votes = proposal
                .for_votes
                .checked_add(weight)
                .ok_or(ErrorCode::NumericalOverflow)?;
        },
        VoteSide::Against {} => {
            proposal.against_votes = proposal
                .against_votes
                .checked_add(weight)
                .ok_or(ErrorCode::NumericalOverflow)?;
        },
        VoteSide::Abstain {} => {
            proposal.abstain_votes = proposal
                .abstain_votes
                .checked_add(weight)
                .ok_or(ErrorCode::NumericalOverflow)?;
        },
    }

    emit!(VoteSetEvent {
        vote: vote.key(),
        proposal: proposal.key(),
        voter: voter_key,
        side: side.clone(),
        weight,
    });
    Ok(())
}

pub fn set_vote(ctx: Context<SetVote>, new_side: VoteSide) -> Result<()> {
    let governor = &ctx.accounts.governor;
    let proposal = &mut ctx.accounts.proposal;
    let vote = &mut ctx.accounts.vote;
    let voter_key = ctx.accounts.voter.key();

    require!(
        governor.voters.iter().any(|vi| vi.pubkey == voter_key),
        ErrorCode::UnauthorisedVoter
    );
    require!(proposal.state == ProposalState::Active, ErrorCode::InvalidStateTransition);

    let new_weight = governor
        .voters
        .iter()
        .find(|vi| vi.pubkey == voter_key)
        .ok_or(ErrorCode::UnauthorisedVoter)?
        .weight;

    let old_side = vote.side.clone();
    let old_weight = vote.weight;

    // Subtract old votes 
    match old_side {
        VoteSide::For {} => {
            proposal.for_votes = proposal.for_votes.checked_sub(old_weight).ok_or(ErrorCode::NumericalOverflow)?;
        },
        VoteSide::Against {} => {
            proposal.against_votes = proposal.against_votes.checked_sub(old_weight).ok_or(ErrorCode::NumericalOverflow)?;
        },
        VoteSide::Abstain {} => {
            proposal.abstain_votes = proposal.abstain_votes.checked_sub(old_weight).ok_or(ErrorCode::NumericalOverflow)?;
        },
    }

    // Add new votes 
    match new_side.clone() {
        VoteSide::For {} => {
            proposal.for_votes = proposal.for_votes.checked_add(new_weight).ok_or(ErrorCode::NumericalOverflow)?;
        },
        VoteSide::Against {} => {
            proposal.against_votes = proposal.against_votes.checked_add(new_weight).ok_or(ErrorCode::NumericalOverflow)?;
        },
        VoteSide::Abstain {} => {
            proposal.abstain_votes = proposal.abstain_votes.checked_add(new_weight).ok_or(ErrorCode::NumericalOverflow)?;
        },
    }

    vote.side = new_side.clone();
    vote.weight = new_weight;
    vote.state = VoteState::Cast;

    emit!(VoteSetEvent {
        vote: vote.key(),
        proposal: proposal.key(),
        voter: voter_key,
        side: new_side,
        weight: vote.weight,
    });
    Ok(())
}
