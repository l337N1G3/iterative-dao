use anchor_lang::prelude::*;

#[event]
pub struct GovernorCreated {
    pub governor: Pubkey,
    pub smart_wallet: Pubkey,
    pub electorate: Pubkey,
    pub vote_threshold: u8,
    pub timelock_delay: i64,
}

#[event]
pub struct ProposalActivated {
    pub proposal: Pubkey,
    pub activated_at: i64,
    pub voting_period: i64,
    pub timelock_delay: i64,
}

#[event]
pub struct ProposalCanceled {
    pub proposal: Pubkey,
    pub canceled_by: Pubkey,
    pub canceled_at: i64,
}

#[event]
pub struct ProposalQueued {
    pub proposal: Pubkey,
    pub queued_at: i64,
    pub ready_to_execute_at: i64,
}

#[event]
pub struct VoteCreateEvent {
    pub vote: Pubkey,
    pub proposal: Pubkey,
    /// CHECK: verify the voter is authorised
    pub voter: Pubkey,
    pub state: crate::enums::VoteState,
}

#[event]
pub struct VoteSetEvent {
    pub vote: Pubkey,
    pub proposal: Pubkey,
    /// CHECK: verify the voter is authorised
    pub voter: Pubkey,
    pub side: crate::enums::VoteSide,
    pub weight: u64,
}

#[event]
pub struct LockEvent {
    pub lock_account: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub lock_id: u64,
}

#[event]
pub struct NewLockerEvent {
    pub locker: Pubkey,
    pub governor: Pubkey,
    pub voting_power_multiplier: u64,
    pub min_lock_duration: i64,
    pub max_lock_duration: i64,
}

#[event]
pub struct LockerSetParamsEvent {
    pub locker: Pubkey,
    pub new_voting_power_multiplier: u64,
    pub new_min_lock_duration: i64,
    pub new_max_lock_duration: i64,
}

#[event]
pub struct NewEscrowEvent {
    pub escrow: Pubkey,
    pub locker: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub start_time: i64,
    pub end_time: i64,
}
