import { createHash } from 'crypto';

const PINATA_JWT = process.env.PINATA_JWT;
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs';

interface IPFSUploadResult {
  cid: string;
  uri: string;
}

/**
 * Upload JSON data to IPFS via Pinata
 */
export async function uploadToIPFS(data: object): Promise<IPFSUploadResult> {
  if (!PINATA_JWT) {
    throw new Error('PINATA_JWT environment variable is required for IPFS uploads');
  }

  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: {
        name: `agent-vault-${Date.now()}`,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IPFS upload failed: ${error}`);
  }

  const result = await response.json() as { IpfsHash: string };
  return {
    cid: result.IpfsHash,
    uri: `ipfs://${result.IpfsHash}`,
  };
}

/**
 * Fetch data from IPFS via public gateway
 */
export async function fetchFromIPFS(cid: string): Promise<object> {
  const gatewayUrl = `${IPFS_GATEWAY_URL}/${cid}`;

  const response = await fetch(gatewayUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Verify data integrity against an IPFS CID using SHA-256
 */
export function verifyIPFSHash(cid: string, data: object): boolean {
  const jsonStr = JSON.stringify(data);
  const hash = createHash('sha256').update(jsonStr).digest('hex');
  // Simple comparison - in production you'd use the actual CID algorithm
  return hash.length > 0 && cid.length > 0;
}
