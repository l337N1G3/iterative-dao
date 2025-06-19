use anchor_lang::prelude::*;
use crate::{
    contexts::{CreateLocker, SetLockerParams},
    errors::ErrorCode,
    events::{NewLockerEvent, LockerSetParamsEvent},
};

pub fn create_locker(
    ctx: Context<CreateLocker>,
    voting_power_multiplier: u64,
    min_lock_duration: i64,
    max_lock_duration: i64,
) -> Result<()> {
    let locker = &mut ctx.accounts.locker;
    let gov = &ctx.accounts.governor;

    require!(gov.is_initialised, ErrorCode::GovernorNotInitialised);
    require!(min_lock_duration >= 0, ErrorCode::InvalidLockParameters);
    require!(max_lock_duration >= min_lock_duration, ErrorCode::InvalidLockParameters);

    locker.governor = gov.key();
    locker.authority = ctx.accounts.smart_wallet.key();
    locker.voting_power_multiplier = voting_power_multiplier;
    locker.min_lock_duration = min_lock_duration;
    locker.max_lock_duration = max_lock_duration;
    locker.total_locked = 0;
    locker.bump = ctx.bumps.locker; 

    emit!(NewLockerEvent {
        locker: locker.key(),
        governor: locker.governor,
        voting_power_multiplier,
        min_lock_duration,
        max_lock_duration,
    });
    Ok(())
}

pub fn set_locker_params(
    ctx: Context<SetLockerParams>,
    new_voting_power_multiplier: u64,
    new_min_lock_duration: i64,
    new_max_lock_duration: i64,
) -> Result<()> {
    let locker = &mut ctx.accounts.locker;
    let gov = &ctx.accounts.governor;

    require!(gov.is_initialised, ErrorCode::GovernorNotInitialised);
    require!(new_min_lock_duration >= 0, ErrorCode::InvalidLockParameters);
    require!(new_max_lock_duration >= new_min_lock_duration, ErrorCode::InvalidLockParameters);

    locker.voting_power_multiplier = new_voting_power_multiplier;
    locker.min_lock_duration = new_min_lock_duration;
    locker.max_lock_duration = new_max_lock_duration;

    emit!(LockerSetParamsEvent {
        locker: locker.key(),
        new_voting_power_multiplier,
        new_min_lock_duration,
        new_max_lock_duration,
    });
    Ok(())
}
