import { getNonce, verifySignature, setToken } from './api'

export async function loginWithWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ success: boolean; isAdmin: boolean; error?: string }> {
  try {
    // Step 1: Get nonce from backend
    let nonce: string, message: string
    try {
      const res = await getNonce(address)
      nonce = res.nonce
      message = res.message
    } catch (err: any) {
      console.error('[auth] Failed to get nonce:', err?.message || err)
      return { success: false, isAdmin: false, error: 'nonce_failed' }
    }

    // Step 2: Sign message with wallet
    let signature: string
    try {
      signature = await signMessage(message)
    } catch (err: any) {
      console.error('[auth] User rejected or signing failed:', err?.message || err)
      return { success: false, isAdmin: false, error: 'sign_rejected' }
    }

    // Step 3: Verify signature on backend
    const { token, user } = await verifySignature(address, signature)
    setToken(token)
    return { success: true, isAdmin: Boolean(user?.isAdmin) }
  } catch (err: any) {
    const msg = err?.message || err?.shortMessage || String(err)
    console.error('[auth] Verification failed:', msg)
    return { success: false, isAdmin: false, error: msg }
  }
}
