import { getNonce, verifySignature, setToken } from './api'

export async function loginWithWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<boolean> {
  try {
    const { nonce } = await getNonce(address)
    const signature = await signMessage(nonce)
    const { token } = await verifySignature(address, signature)
    setToken(token)
    return true
  } catch {
    return false
  }
}
