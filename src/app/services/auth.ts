import { getNonce, verifySignature, setToken } from './api'

export async function loginWithWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ success: boolean; isAdmin: boolean; error?: string }> {
  try {
    // Step 1: Get nonce from backend
    console.log('[auth] Step 1: Getting nonce for', address)
    let nonce: string, message: string
    try {
      const res = await getNonce(address)
      nonce = res.nonce
      message = res.message
      console.log('[auth] Step 1 OK: Got nonce')
    } catch (err: any) {
      console.error('[auth] Step 1 FAILED: getNonce error:', err?.message || err)
      return { success: false, isAdmin: false, error: 'nonce_failed' }
    }

    // Step 2: Sign message with wallet
    console.log('[auth] Step 2: Requesting wallet signature...')
    let signature: string
    try {
      signature = await signMessage(message)
      console.log('[auth] Step 2 OK: Got signature')
    } catch (err: any) {
      console.error('[auth] Step 2 FAILED: Signing error:', err?.message || err)
      return { success: false, isAdmin: false, error: 'sign_rejected' }
    }

    // Step 3: Verify signature on backend
    console.log('[auth] Step 3: Verifying signature on backend...')
    const { token, user } = await verifySignature(address, signature)
    console.log('[auth] Step 3 OK: Got token, isAdmin:', user?.isAdmin)
    setToken(token)
    return { success: true, isAdmin: Boolean(user?.isAdmin) }
  } catch (err: any) {
    const msg = err?.message || err?.shortMessage || String(err)
    console.error('[auth] Step 3 FAILED: Verification error:', msg)
    return { success: false, isAdmin: false, error: 'verify_failed' }
  }
}
