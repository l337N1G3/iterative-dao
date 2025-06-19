use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_spl::token::{self, Transfer};
use crate::{
    contexts::CreateEscrow,
    errors::ErrorCode,
    events::NewEscrowEvent
};

pub fn create_escrow(ctx: Context<CreateEscrow>, amount: u64, duration: i64, escrow_id: u64) -> Result<()> {
    let gov = &ctx.accounts.governor;
    let user_key = ctx.accounts.user.key();
    require!(
        gov.voters.iter().any(|v| v.pubkey == user_key),
        ErrorCode::UnauthorisedVoter
    );
    let locker = &mut ctx.accounts.locker;
    require!(duration >= locker.min_lock_duration, ErrorCode::InvalidLockParameters);
    require!(duration <= locker.max_lock_duration, ErrorCode::InvalidLockParameters);
    require!(amount > 0, ErrorCode::InvalidLockParameters);

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount).map_err(|_| ErrorCode::InsufficientBalance)?;

    locker.total_locked = locker
        .total_locked
        .checked_add(amount)
        .ok_or(ErrorCode::NumericalOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    let escrow_acc = &mut ctx.accounts.escrow;
    escrow_acc.user = user_key;
    escrow_acc.locker = locker.key();
    escrow_acc.amount = amount;
    escrow_acc.start_time = now;
    escrow_acc.duration = duration;
    escrow_acc.end_time = now.checked_add(duration).ok_or(ErrorCode::NumericalOverflow)?;
    escrow_acc.withdrawn = false;
    escrow_acc.escrow_token_account = ctx.accounts.escrow_token_account.key();
    escrow_acc.bump = ctx.bumps.escrow;

    emit!(NewEscrowEvent {
        escrow: escrow_acc.key(),
        locker: locker.key(),
        user: user_key,
        amount,
        start_time: escrow_acc.start_time,
        end_time: escrow_acc.end_time,
    });
    Ok(())
}
