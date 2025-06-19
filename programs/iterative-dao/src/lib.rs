use anchor_lang::prelude::*;
use crate::AddVoter;

pub mod governor;
pub mod proposals;
pub mod votes;
pub mod tokens;
pub mod locker;
pub mod escrow;
pub mod events;
pub mod errors;
pub mod contexts;
pub mod state;
pub mod enums;

pub use contexts::*;
pub use errors::*;
pub use state::*;
    

declare_id!("J7Gebb7AjNScTT5qywZL5vfpRyLUR1K9h1qShRS5KGwx");

#[program]
pub mod iterative_dao {
    use super::*;

    //  Governor Management 
    pub fn init_governor(
        ctx: Context<InitGovernor>,
        vote_threshold: u8,
        timelock_delay: i64,
        electorate: Pubkey,
        governance_mint: Pubkey,
    ) -> Result<()> {
        governor::init_governor(ctx, vote_threshold, timelock_delay, electorate, governance_mint)
    }

    pub fn add_voter(ctx: Context<AddVoter>, new_voter: Pubkey, weight: u64) -> Result<()> {
        governor::add_voter(ctx, new_voter, weight)
    }

    //  Proposal Management 
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        instructions: Vec<state::ProposalInstruction>,
    ) -> Result<()> {
        proposals::create_proposal(ctx, instructions)
    }

    pub fn activate_proposal(ctx: Context<ActivateProposal>, voting_period: i64) -> Result<()> {
        proposals::activate_proposal(ctx, voting_period)
    }

    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        proposals::cancel_proposal(ctx)
    }

    pub fn queue_proposal(ctx: Context<QueueProposal>) -> Result<()> {
        proposals::queue_proposal(ctx)
    }

    pub fn finalise_proposal(ctx: Context<FinaliseProposal>) -> Result<()> {
        proposals::finalise_proposal(ctx)
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        proposals::execute_proposal(ctx)
    }

    //  Voting 
    pub fn create_vote(ctx: Context<CreateVote>) -> Result<()> {
        votes::create_vote(ctx)
    }

    pub fn cast_vote(
        ctx: Context<CastVote>,
        side: enums::VoteSide,
        weight: u64,
    ) -> Result<()> {
        votes::cast_vote(ctx, side, weight)
    }

    pub fn set_vote(ctx: Context<SetVote>, new_side: enums::VoteSide) -> Result<()> {
        votes::set_vote(ctx, new_side)
    }

    //  Token Locking 
    pub fn lock_tokens(
        ctx: Context<LockTokens>,
        amount: u64,
        duration: i64,
        lock_id: u64,
    ) -> Result<()> {
        tokens::lock_tokens(ctx, amount, duration, lock_id)
    }

    pub fn withdraw_tokens(ctx: Context<WithdrawTokens>, lock_id: u64) -> Result<()> {
        tokens::withdraw_tokens(ctx, lock_id)
    }

    //  Locker 
    pub fn create_locker(
        ctx: Context<CreateLocker>,
        voting_power_multiplier: u64,
        min_lock_duration: i64,
        max_lock_duration: i64,
    ) -> Result<()> {
        locker::create_locker(ctx, voting_power_multiplier, min_lock_duration, max_lock_duration)
    }

    pub fn set_locker_params(
        ctx: Context<SetLockerParams>,
        new_voting_power_multiplier: u64,
        new_min_lock_duration: i64,
        new_max_lock_duration: i64,
    ) -> Result<()> {
        locker::set_locker_params(ctx, new_voting_power_multiplier, new_min_lock_duration, new_max_lock_duration)
    }

    //  Escrow 
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        amount: u64,
        duration: i64,
        escrow_id: u64,
    ) -> Result<()> {
        escrow::create_escrow(ctx, amount, duration, escrow_id)
    }
}
