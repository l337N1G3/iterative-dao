use anchor_lang::prelude::*;

#[derive(Clone, AnchorSerialize, AnchorDeserialize, PartialEq)]
pub enum ProposalState {
    Draft,
    Active,
    Succeeded,
    Queued,
    Executed,
    Rejected,
    Canceled,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug)]
pub enum VoteSide {
    For {},
    Against {},
    Abstain {},
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub enum VoteState {
    Pending,
    Cast,
}
