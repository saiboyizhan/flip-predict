import { getNonce, verifySignature, setToken } from './api'

export async function loginWithWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ success: boolean; isAdmin: boolean }> {
  try {
    const { nonce, message } = await getNonce(address)
    void nonce
    const signature = await signMessage(message)
    const { token, user } = await verifySignature(address, signature)
    setToken(token)
    return { success: true, isAdmin: Boolean(user?.isAdmin) }
  } catch {
    return { success: false, isAdmin: false }
  }
}
