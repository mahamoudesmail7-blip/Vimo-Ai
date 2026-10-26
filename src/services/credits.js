// Every change to a user's credits goes through applyCredits(), inside a DB
// transaction that also writes the ledger row, so a balance is never changed
// without a record of why.
import { prisma } from '../db.js';
import { AppError } from '../errors.js';

/**
 * @param {object} tx      a Prisma transaction client (or prisma itself)
 * @param {number} userId
 * @param {number} delta   +N adds, -N spends
 */
export async function applyCredits(tx, userId, delta, reason, { ref = null, note = null } = {}) {
  if (delta < 0) {
    // Conditional decrement: never goes below zero even with two requests at once.
    const { count } = await tx.user.updateMany({ where: { id: userId, credits: { gte: -delta } }, data: { credits: { increment: delta } } });
    if (!count) throw new AppError('رصيدك مش كفاية. اشحن باقة الأول.', 402, 'NO_CREDITS');
  } else {
    await tx.user.update({ where: { id: userId }, data: { credits: { increment: delta } } });
  }
  const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
  await tx.creditTransaction.create({ data: { user_id: userId, delta, balance: user.credits, reason, ref, note } });
  return user.credits;
}

export async function refundVideo(job) {
  return prisma.$transaction(async (tx) => {
    // flip `refunded` first so a second worker pass can never refund twice
    const { count } = await tx.videoJob.updateMany({ where: { id: job.id, charged: true, refunded: false }, data: { refunded: true } });
    if (!count) return null;
    return applyCredits(tx, job.user_id, 1, 'REFUND', { ref: `video:${job.id}`, note: 'رجوع رصيد فيديو فشل' });
  });
}
