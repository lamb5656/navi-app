export async function withBackoff(fn, { retries = 3, base = 400 } = {}) {
  let err;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      if (i < retries) {
        await new Promise(r => setTimeout(r, base * 2 ** i));
      }
    }
  }
  throw err;
}
