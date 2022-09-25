const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { getMessageLocation } = require('./get-location');

require('dotenv').config();
const { tenantId, directory } = initArgs();


const mongoClient = new MongoClient(process.env.DATABASE_URL);
const db = mongoClient.db(process.env.DATABASE_NAME);
const messagesCollection = db.collection('messages');


mongoClient
    .connect()
    .then(() => importMessages())
    .catch(console.error)
    .finally(async () => await mongoClient.close());


function initArgs() {

    const yargs = require('yargs/yargs');
    const { hideBin } = require('yargs/helpers');
    const argv = yargs(hideBin(process.argv))
        .options({
            'h': {
                alias: 'help'
            },
            'd': {
                alias: 'dir',
                demandOption: true,
                type: 'string',
            },
            't': {
                alias: 'tenant',
                demandOption: true,
                type: 'number',
            }
        })
        .version()
        .argv;

    return { tenantId: argv.tenant, directory: argv.dir };

}


async function importMessages() {

    const filenames = fs.readdirSync(path.join(directory, `${tenantId}`, 'messages'));
    const documents = filenames
        .filter(filename => filename.startsWith('message-') && filename.endsWith('.json'))
        .map(filename => {
            const messageTxt = fs.readFileSync(path.join(directory, `${tenantId}`, 'messages', filename), 'utf-8');
            const message = JSON.parse(messageTxt);
            const location = getMessageLocation(message);
            return { ...message, tenantId, location };
        });
    const insertOperations = documents.map(document => ({ insertOne: { document }}));
    if (insertOperations.length > 0) {
        const result = await messagesCollection.bulkWrite(insertOperations);
        console.log(`Added ${result.result.nInserted} message(s) to the database.`)
    } else {
        console.log('No documents to import');
    }

}
