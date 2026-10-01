import Stripe from 'npm:stripe@22.6.2'

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}

export const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))

// Deno has no synchronous Node crypto; webhook signatures must be verified
// with constructEventAsync + the SubtleCrypto provider.
export const cryptoProvider = Stripe.createSubtleCryptoProvider()

export type { Stripe }
