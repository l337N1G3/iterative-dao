use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use anchor_spl::token::Token;
use {
    crate::state::{Governor, Proposal, Vote, LockAccount, Locker, Escrow},
    crate::enums::{ProposalState, VoteState},
};


#[derive(Accounts)]
pub struct InitGovernor<'info> {
    #[account(
        init,
        payer = payer,
        space = Governor::LEN,
        seeds = [b"governor", smart_wallet.key().as_ref()],
        bump
    )]
    pub governor: Account<'info, Governor>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddVoter<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub governor: Account<'info, Governor>,
    #[account(
        init,
        payer = payer,
        space = Proposal::LEN,
        seeds = [b"proposal", governor.key().as_ref(), &governor.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateProposal<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(
        mut,
        has_one = governor,
        constraint = proposal.state == ProposalState::Draft
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(
        mut,
        has_one = governor,
        constraint = proposal.state == ProposalState::Draft,
        constraint = proposal.proposer == proposer.key()
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    /// CHECK: Verified by comparing proposal.proposer
    pub proposer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct QueueProposal<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(
        mut,
        has_one = governor,
        constraint = proposal.state == ProposalState::Succeeded
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateVote<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(
        mut,
        constraint = proposal.governor == governor.key(),
        constraint = proposal.state == ProposalState::Active
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = payer,
        space = Vote::LEN,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, Vote>,
    #[account(signer)]
    /// CHECK: Verified in logic.
    pub voter: AccountInfo<'info>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        mut,
        constraint = vote.proposal == proposal.key(),
        constraint = vote.voter == voter.key(),
        constraint = vote.state == VoteState::Pending
    )]
    pub vote: Account<'info, Vote>,
    #[account(signer)]
    /// CHECK: Verified in logic.
    pub voter: AccountInfo<'info>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetVote<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(
        mut,
        constraint = proposal.governor == governor.key(),
        constraint = proposal.state == ProposalState::Active
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        mut,
        constraint = vote.proposal == proposal.key(),
        constraint = vote.voter == voter.key()
    )]
    pub vote: Account<'info, Vote>,
    #[account(signer)]
    /// CHECK: Verified in logic.
    pub voter: AccountInfo<'info>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinaliseProposal<'info> {
    #[account(has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, duration: i64, lock_id: u64)]
pub struct LockTokens<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(signer)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = LockAccount::LEN,
        seeds = [b"lock", governor.key().as_ref(), user.key().as_ref(), &lock_id.to_le_bytes()],
        bump
    )]
    pub lock_account: Account<'info, LockAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
    #[account(mut, has_one = user)]
    pub lock_account: Account<'info, LockAccount>,
    #[account(signer)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(mut)]
    pub governor: Account<'info, Governor>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[derive(Accounts)]
#[instruction(voting_power_multiplier: u64, min_lock_duration: i64, max_lock_duration: i64)]
pub struct CreateLocker<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(
        init,
        payer = payer,
        space = Locker::LEN,
        seeds = [b"locker", governor.key().as_ref()],
        bump
    )]
    pub locker: Account<'info, Locker>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetLockerParams<'info> {
    #[account(mut, has_one = governor, has_one = authority)]
    pub locker: Account<'info, Locker>,
    pub governor: Account<'info, Governor>,
    #[account(signer)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(amount: u64, duration: i64, escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut, has_one = smart_wallet)]
    pub governor: Account<'info, Governor>,
    #[account(mut, has_one = governor)]
    pub locker: Account<'info, Locker>,
    #[account(signer)]
    pub smart_wallet: Signer<'info>,
    #[account(signer)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = Escrow::LEN,
        seeds = [b"escrow", locker.key().as_ref(), user.key().as_ref(), &escrow_id.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

