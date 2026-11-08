import { getStore } from '@netlify/blobs';
import { handler } from '../lib/accessibilite.mjs';

export default handler({
  store: () => getStore({ name: 'accessibilite', region: 'eu-central-1', consistency: 'strong' })
});
