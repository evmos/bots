import fetch from 'node-fetch';

export async function query(
  endpoint: string,
  url = 'http://127.0.0.1:1317'
): Promise<unknown> {
  const res = await fetch(`${url}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' }
  });
  return res.json();
}
