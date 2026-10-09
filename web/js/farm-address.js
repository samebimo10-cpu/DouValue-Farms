// The farm server's address, for phones that have never been signed in (UX-28).
//
// With it filled in, the sign-in page on a new phone asks for two things only:
// the sign-in name and the password the CEO sent. Left empty, the page also
// asks for the address, once; the link in the CEO's message fills it in.
//
// It is the address the server gave when it was deployed, such as
// 'https://douvalue-farm.deno.net'. It is not a secret: every phone on the farm
// is told it anyway.
export const FARM_SERVER = 'https://douvalue-sync-2.samebimo10-cpu69.deno.net';
