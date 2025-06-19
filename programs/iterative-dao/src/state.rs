use anchor_lang::prelude::*;
use crate::enums::{ProposalState, VoteSide, VoteState};

#[account]
pub struct Governor {
    pub vote_threshold: u8,
    pub timelock_delay: i64,
    pub smart_wallet: Pubkey,
    pub electorate: Pubkey,
    pub is_initialised: bool,
    pub proposal_count: u64,
    pub governance_mint: Pubkey,
    pub voters: Vec<VoterInfo>,
    pub padding: [u8; 2],
}

impl Governor {
    pub const LEN: usize = 8 + 1 + 8 + 32 + 32 + 1 + 8 + 32 + 4 + (16 * 40) + 2;
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct VoterInfo {
    pub pubkey: Pubkey,
    pub weight: u64,
}

#[account]
pub struct Proposal {
    pub governor: Pubkey,
    pub proposer: Pubkey,
    pub instructions: Vec<ProposalInstruction>,
    pub state: ProposalState,
    pub proposal_id: u64,
    pub activated_at: i64,
    pub voting_period: i64,
    pub timelock_delay: i64,
    pub queued_at: i64,
    pub ready_to_execute_at: i64,
    pub for_votes: u64,
    pub against_votes: u64,
    pub abstain_votes: u64,
    pub padding: [u8; 3],
}

impl Proposal {
    pub const LEN: usize = 8 + 32 + 32 + 4 + (10 * 136) + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 3;
}

#[account]
pub struct Vote {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub side: VoteSide,
    pub weight: u64,
    pub state: VoteState,
    pub padding: [u8; 6],
}

impl Vote {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 1 + 6;
}

#[account]
pub struct LockAccount {
    pub user: Pubkey,
    pub amount: u64,
    pub start_time: i64,
    pub duration: i64,
    pub end_time: i64,
    pub withdrawn: bool,
    pub escrow_token_account: Pubkey,
    pub padding: [u8; 6],
    pub bump: u8,
}

impl LockAccount {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 32 + 6 + 1;
}

#[account]
pub struct Locker {
    pub governor: Pubkey,
    pub authority: Pubkey,
    pub voting_power_multiplier: u64,
    pub min_lock_duration: i64,
    pub max_lock_duration: i64,
    pub total_locked: u64,
    pub bump: u8,
}

impl Locker {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Escrow {
    pub user: Pubkey,
    pub locker: Pubkey,
    pub amount: u64,
    pub start_time: i64,
    pub duration: i64,
    pub end_time: i64,
    pub withdrawn: bool,
    pub escrow_token_account: Pubkey,
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 32 + 1;
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ProposalInstruction {
    pub program_id: Pubkey,
    pub accounts: Vec<ProposalAccount>,
    pub data: Vec<u8>,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ProposalAccount {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}
