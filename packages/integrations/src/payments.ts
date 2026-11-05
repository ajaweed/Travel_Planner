// Payment capture via Stripe PaymentIntents.
//
// SECURITY / PCI-DSS: raw card data must NEVER reach this server. The client
// collects card details with Stripe Elements/Payment Element and exchanges
// them for a PaymentMethod directly with Stripe; only the resulting
// paymentMethodId (or an already-confirmed paymentIntentId) crosses the wire
// to us. This module only ever sees Stripe-issued identifiers.
//
// IMPORTANT — production readiness: STRIPE_ENV must stay "test" until the
// Stripe account has completed identity/business verification ("Activate
// your account") — live secret keys won't work for real charges before that.

import type { IdempotentRequest, Money, ProviderResult } from "./types";

type PaymentCaptureRequest = {
  amount: Money;
  paymentMethodId: string;
  customerId?: string;
  description: string;
};

type PaymentCaptureResult = {
  paymentIntentId: string;
  status: "succeeded" | "requires_action";
  clientSecret?: string; // present when status is requires_action (3DS, etc.)
};

function secretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY;
}

function apiBase(): string {
  return "https://api.stripe.com/v1";
}

export async function capturePayment(
  req: IdempotentRequest<PaymentCaptureRequest>,
): Promise<ProviderResult<PaymentCaptureResult>> {
  const key = secretKey();
  if (!key) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "STRIPE_SECRET_KEY is not set.",
    };
  }
  const env = process.env.STRIPE_ENV ?? "test";
  if (env === "live" && !key.startsWith("sk_live_")) {
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message: "STRIPE_ENV is 'live' but STRIPE_SECRET_KEY is not a live key.",
      retryable: false,
    };
  }

  try {
    const body = new URLSearchParams({
      amount: String(req.amount.amountCents),
      currency: req.amount.currency.toLowerCase(),
      payment_method: req.paymentMethodId,
      confirm: "true",
      description: req.description,
    });
    if (req.customerId) body.set("customer", req.customerId);

    const res = await fetch(`${apiBase()}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Stripe's native idempotency support — safe to retry this exact call.
        "Idempotency-Key": req.idempotencyKey,
      },
      body,
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; code?: string };
      };
      if (errJson.error?.code === "card_declined") {
        return {
          ok: false,
          reason: "PROVIDER_ERROR",
          message: "Card declined.",
          retryable: false,
        };
      }
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: errJson.error?.message ?? `Stripe error: ${res.status}`,
        retryable: res.status >= 500,
      };
    }

    const json = (await res.json()) as {
      id: string;
      status: string;
      client_secret?: string;
    };

    return {
      ok: true,
      data: {
        paymentIntentId: json.id,
        status: json.status === "succeeded" ? "succeeded" : "requires_action",
        clientSecret: json.client_secret,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}

export async function refundPayment(
  req: IdempotentRequest<{ paymentIntentId: string; amount?: Money }>,
): Promise<ProviderResult<{ refundId: string }>> {
  const key = secretKey();
  if (!key) {
    return { ok: false, reason: "NOT_CONFIGURED", message: "STRIPE_SECRET_KEY is not set." };
  }
  try {
    const body = new URLSearchParams({ payment_intent: req.paymentIntentId });
    if (req.amount) body.set("amount", String(req.amount.amountCents));

    const res = await fetch(`${apiBase()}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": req.idempotencyKey,
      },
      body,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: `Stripe refund failed: ${res.status}`,
        retryable: res.status >= 500,
      };
    }
    const json = (await res.json()) as { id: string };
    return { ok: true, data: { refundId: json.id } };
  } catch (err) {
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}
