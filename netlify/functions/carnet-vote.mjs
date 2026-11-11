import { getStore } from '@netlify/blobs';
import { handler } from '../lib/carnet-vote/vote-handler.mjs';
import catalog from '../../carnet-2027/data/catalog.json' with { type:'json' };
import activation from '../lib/carnet-vote/bootstrap.json' with { type:'json' };
export default handler({store:()=>getStore({name:'carnet-vote-2027',region:'eu-central-1',consistency:'strong'}),films:catalog.films,bootstrapHash:()=>activation.sha256});
