// A promise a test settles by hand, to hold the code under test at an await
// until the test lets it go on. Promise.withResolvers does this too, but the
// app's tsconfig targets ES2023, which doesn't have it.
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
