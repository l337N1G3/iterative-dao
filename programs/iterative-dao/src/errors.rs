use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Governor not initialisd yet.")]
    GovernorNotInitialised,
    #[msg("Invalid instructions: Instructions array cannot be empty.")]
    InvalidInstructions,
    #[msg("Invalid vote threshold, must be between 0 and 100.")]
    InvalidVoteThreshold,
    #[msg("Invalid timelock delay, must be non-negative.")]
    InvalidTimelockDelay,
    #[msg("Unauthorised proposer.")]
    UnauthorisdeProposer,
    #[msg("Unauthorisd voter.")]
    UnauthorisedVoter,
    #[msg("Unauthorisd to cancel proposal.")]
    UnauthorisedCancellation,
    #[msg("Invalid state transition.")]
    InvalidStateTransition,
    #[msg("Invalid voting period - must be positive.")]
    InvalidVotingPeriod,
    #[msg("Invalid activation time.")]
    InvalidActivationTime,
    #[msg("Numerical overflow occurred.")]
    NumericalOverflow,
    #[msg("Timelock not expired.")]
    TimelockNotExpired,
    #[msg("Voting period still active.")]
    VotingPeriodActive,
    #[msg("Duplicate Voter.")]
    DuplicateVoter,
    #[msg("Invalid lock parameters (amount/duration).")]
    InvalidLockParameters,
    #[msg("Insufficient token balance.")]
    InsufficientBalance,
    #[msg("Tokens have already been withdrawn.")]
    AlreadyWithdrawn,
    #[msg("Lock period has not expired.")]
    LockNotExpired,
}
