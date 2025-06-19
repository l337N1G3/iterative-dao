use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_spl::token::{self, Transfer, Token, TokenAccount};
use crate::{
    contexts::{LockTokens, WithdrawTokens},
    errors::ErrorCode,
    events::{LockEvent, WithdrawEvent},
    state::LockAccount,
};

pub fn lock_tokens(ctx: Context<LockTokens>, amount: u64, duration: i64, lock_id: u64) -> Result<()> {
    let governor = &ctx.accounts.governor;
    let lock_acc = &mut ctx.accounts.lock_account;
    let user_key = ctx.accounts.user.key();

    require!(
        governor.voters.iter().any(|v| v.pubkey == user_key),
        ErrorCode::UnauthorisedVoter
    );
    require!(amount > 0 && duration > 0, ErrorCode::InvalidLockParameters);

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount).map_err(|_| ErrorCode::InsufficientBalance)?;

    let now = Clock::get()?.unix_timestamp;
    lock_acc.user = user_key;
    lock_acc.amount = amount;
    lock_acc.start_time = now;
    lock_acc.duration = duration;
    lock_acc.end_time = now.checked_add(duration).ok_or(ErrorCode::NumericalOverflow)?;
    lock_acc.withdrawn = false;
    lock_acc.escrow_token_account = ctx.accounts.escrow_token_account.key();
    lock_acc.padding = [0u8; 6];
    lock_acc.bump = ctx.bumps.lock_account; // Use indexing

    emit!(LockEvent {
        lock_account: lock_acc.key(),
        user: user_key,
        amount,
        start_time: lock_acc.start_time,
        end_time: lock_acc.end_time,
    });
    Ok(())
}

pub fn withdraw_tokens(ctx: Context<WithdrawTokens>, lock_id: u64) -> Result<()> {
    let lock_account = &mut ctx.accounts.lock_account;
    let now = Clock::get()?.unix_timestamp;
    if now < lock_account.end_time {
        return Err(ErrorCode::LockNotExpired.into());
    }
    if lock_account.withdrawn {
        return Err(ErrorCode::AlreadyWithdrawn.into());
    }
    let cpi_accounts = Transfer {
        from: ctx.accounts.escrow_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.smart_wallet.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, lock_account.amount).map_err(|_| ErrorCode::InsufficientBalance)?;
    lock_account.withdrawn = true;
    emit!(WithdrawEvent {
        user: lock_account.user,
        amount: lock_account.amount,
        lock_id,
    });
    Ok(())
}
