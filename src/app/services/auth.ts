import { getNonce, verifySignature, setToken } from './api'

export async function loginWithWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ success: boolean; isAdmin: boolean; error?: string }> {
  try {
    const { nonce, message } = await getNonce(address)
    void nonce
    const signature = await signMessage(message)
    const { token, user } = await verifySignature(address, signature)
    setToken(token)
    return { success: true, isAdmin: Boolean(user?.isAdmin) }
  } catch (err: any) {
    const msg = err?.message || err?.shortMessage || String(err)
    console.error('[auth] Login failed:', msg)
    return { success: false, isAdmin: false, error: msg }
  }
}
