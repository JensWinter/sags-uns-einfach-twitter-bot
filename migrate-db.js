const { MongoClient, ObjectId } = require('mongodb');

require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_NAME = process.env.DATABASE_NAME;
const DATABASE_URL_MIGRATED = process.env.DATABASE_URL_MIGRATED;
const DATABASE_NAME_MIGRATED = process.env.DATABASE_NAME_MIGRATED;

const mongoClientSource = new MongoClient(DATABASE_URL);
const db = mongoClientSource.db(DATABASE_NAME);
const messagesCollectionSource = db.collection('messages');

messagesCollectionSource
    .find({})
    .toArray()
    .then(messages => {

        const mongoClientDest = new MongoClient(DATABASE_URL_MIGRATED);
        const dbDest = mongoClientDest.db(DATABASE_NAME_MIGRATED);
        const messagesCollectionDest = dbDest.collection('messages');

        messagesCollectionDest
            .bulkWrite(messages.map(message => {
                    const origMessage = { ...message };
                    delete origMessage.location;
                    delete origMessage.tenantKey;
                    delete origMessage._id;
                    return {
                            insertOne: {
                                    document: {
                                            _id: message._id,
                                            id: `${message.id}`,
                                            tenantKey: message.tenantKey,
                                            providerKey: 'sue',
                                            location: message.location,
                                            data: origMessage
                                    }
                            }
                    };
            }))
            .then(console.log)
            .finally(() => mongoClientDest.close());

    })
    .finally(() => mongoClientSource.close());


/*
messagesCollection
    .updateMany(
        { _id: { $ne: ObjectId('63301d37e9c44a08ce9c5315') }},
        [
            {
                $set: {
                    id: { $toString: '$id' },
                    tenantKey: '$tenantKey',
                    providerKey: 'sue',
                    location: '$location',
                    data: {
                        createdDate: '$createdDate',
                        id: '$id',
                        lastUpdated: '$lastUpdated',
                        message: '$message',
                        messageImage: '$messageImage',
                        messagePosition: '$messagePosition',
                        responses: '$responses',
                        status: '$status',
                        subject: '$subject'
                    }
                }
            },
            { $unset: ['createdDate', 'lastUpdated', 'message', 'messageImage', 'messagePosition', 'responses', 'status', 'subject'] }
        ])
    .then(result => {
        console.log(result);
        mongoClient.close();
    });
*/
