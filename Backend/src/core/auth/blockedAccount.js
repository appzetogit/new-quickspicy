import { prisma } from "../../config/prisma.js";
import { logger } from "../../utils/logger.js";

/**
 * What a blocked customer or rider is told: the reason the admin gave, when
 * there is one, and the support number to call (Admin -> Business settings),
 * when one is set.
 *
 * Kept apart from auth.service.js so the request middleware can use it without
 * importing the whole login flow.
 *
 * @param {string|null|undefined} reason the account's banReason
 */
export async function blockedAccountMessage(reason) {
  let phone = "";
  try {
    const s = await prisma.foodBusinessSettings.findFirst({
      select: { phoneCountryCode: true, phoneNumber: true },
    });
    if (s?.phoneNumber) phone = `${s.phoneCountryCode || ""} ${s.phoneNumber}`.trim();
  } catch (err) {
    logger.warn(`blockedAccountMessage: business settings unavailable: ${err?.message}`);
  }
  return formatBlockedMessage(reason, phone);
}

/** The wording alone, for tests and callers that already have the phone. */
export function formatBlockedMessage(reason, phone) {
  const why = String(reason || "").trim().replace(/[.\s]+$/, "");
  const contact = phone
    ? `Please contact the Quick Spicy team at ${phone}.`
    : "Please contact the Quick Spicy team.";
  return why
    ? `Quick Spicy banned your account due to the reason: ${why}. ${contact}`
    : `Quick Spicy has blocked your account. ${contact}`;
}

/**
 * An AuthError-shaped error carrying the ban details, so the error handler can
 * hand isBlocked/banReason to the app next to the message.
 */
export function blockedAccountError(ErrorClass, message, reason) {
  const err = new ErrorClass(message);
  err.isBlocked = true;
  err.banReason = reason ? String(reason) : null;
  return err;
}
