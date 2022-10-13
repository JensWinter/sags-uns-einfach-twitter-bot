'use strict';

const https = require('https');
const fs = require('fs');
const winston = require('winston');
const dateFns = require('date-fns');
const { MongoClient } = require('mongodb');
const { getMessageLocation } = require('./get-location');
const AWS = require('aws-sdk');

require('dotenv').config();
const tenant = initArgs();
if (!tenant) {
    console.error('Couldn\'t load tenant configuration.');
    process.exit(1);
}

const tenantName = tenant.name;
const tenantId = tenant.id;
const baseUrl = tenant.config.baseUrl;
const tenantBaseUrl = `${baseUrl}/mobileportalpms/${tenantId}`;

const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantId}`;
const messagesDir = `${tenantDir}/messages`;
const allMessagesFilename = `${messagesDir}/all-messages.json`;
const imagesDir = `${tenantDir}/images`;
const queueNewMessagesDir = `${tenantDir}/queue_new_messages`;
const queueResponseUpdatesDir = `${tenantDir}/queue_response_updates`;
const queueStatusUpdatesDir = `${tenantDir}/queue_status_updates`;
const archiveDir = './archive';
const tenantArchiveDir = `${archiveDir}/${tenantId}`;
const archiveImagesDir = `${tenantArchiveDir}/images`;
const archiveMessagesDir = `${tenantArchiveDir}/messages`;

const logger = initLogger();

const LIMIT_MESSAGES_FETCH = tenant.config.limitMessagesFetch;
const PROCESS_DELAY_SECONDS = tenant.config.processDelaySeconds;
const MAX_QUEUE_SIZE = tenant.config.maxQueueSize;
const LOG_TO_SLACK_CHANNEL = tenant.config.logToSlackChannel;
const ARCHIVE_OLD_MESSAGES = tenant.config.archiveOldMessages;

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_NAME = process.env.DATABASE_NAME;


const mongoClient = new MongoClient(DATABASE_URL);
const db = mongoClient.db(DATABASE_NAME);
const messagesCollection = db.collection('messages');


const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
});


logger.info('Run initiated.')


prepareTenantDirectories();


mongoClient
    .connect()
    .then(async () => fetchAndProcessMessages().then(async () => await mongoClient.close()).catch(logger.error))
    .catch(logger.error);


function initArgs() {

    const yargs = require('yargs/yargs');
    const { hideBin } = require('yargs/helpers');
    const argv = yargs(hideBin(process.argv))
        .options({
            'h': {
                alias: 'help'
            },
            't': {
                alias: 'tenant',
                demandOption: true,
                type: 'number',
            }
        })
        .coerce('tenant', arg => {
            const tenants = JSON.parse(fs.readFileSync('./tenants.json', 'utf-8'));
            const tenant = tenants.find(t => t.config.active && t.providers.sue?.id === arg);
            if (tenant) {
                return {
                    name: tenant.name,
                    id: tenant.providers.sue.id,
                    config: tenant.config
                };
            }
            return null;
        })
        .version()
        .argv;

    return argv.tenant;

}


function initLogger() {

    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({ filename: `${tenantDir}/output-fetch-messages.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function prepareTenantDirectories() {
    if (!fs.existsSync(messagesDir)) {
        logger.info('Creating messages directory.')
        fs.mkdirSync(messagesDir, { recursive: true });
    }
    if (!fs.existsSync(imagesDir)) {
        logger.info('Creating images directory.')
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    if (!fs.existsSync(allMessagesFilename)) {
        logger.info('Creating messages file.')
        fs.writeFileSync(allMessagesFilename, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(queueNewMessagesDir)) {
        logger.info('Creating new messages queue directory.')
        fs.mkdirSync(queueNewMessagesDir, { recursive: true });
    }
    if (!fs.existsSync(queueResponseUpdatesDir)) {
        logger.info('Creating response updates queue directory.')
        fs.mkdirSync(queueResponseUpdatesDir, { recursive: true });
    }
    if (!fs.existsSync(queueStatusUpdatesDir)) {
        logger.info('Creating status updates queue directory.')
        fs.mkdirSync(queueStatusUpdatesDir, { recursive: true });
    }
    if (ARCHIVE_OLD_MESSAGES && !fs.existsSync(archiveMessagesDir)) {
        fs.mkdirSync(archiveMessagesDir, { recursive: true });
    }
    if (ARCHIVE_OLD_MESSAGES && !fs.existsSync(archiveImagesDir)) {
        fs.mkdirSync(archiveImagesDir, { recursive: true });
    }
}


async function fetchAndProcessMessages() {

    return new Promise((resolve, reject) => {

        const req = https.get(`${tenantBaseUrl}?format=json&action=search&limit=${LIMIT_MESSAGES_FETCH}`, res => {

            if (res.statusCode !== 200) {
                logFailedDataFetch(res.statusMessage);
                return reject(res.statusMessage);
            }

            let body = '';

            res.on('data', d => body += d);
            res.on('end', () => {

                // Get the messages that are currently available
                const currentMessages = JSON.parse(body);

                // Load all the messages we already know
                const pastMessages = loadPastMessages();

                // Check for messages we haven't seen yet
                const newMessages = findNewMessages(currentMessages, pastMessages);

                processNewMessages(pastMessages, newMessages)
                    .then(() => {

                        logger.info('Processing new messages finished.');

                        // Check if there are any updates to already known messages
                        processMessageUpdates(currentMessages)
                            .then(() => {

                                logger.info('Processing message updates finished.');

                                if (ARCHIVE_OLD_MESSAGES) {
                                    archiveOldMessages(pastMessages, currentMessages)
                                        .then(() => {
                                            logger.info('Archiving old messages finished.');
                                            resolve();
                                        })
                                        .catch(e => {
                                            logger.error('Archiving old messages finished with errors.', e);
                                            reject(e);
                                        });
                                }

                            })
                            .catch(e => {
                                logger.error('Processing message updates finished with errors.', e);
                                reject(e);
                            });

                    })
                    .catch(e => {
                        logger.error('Processing new messages finished with errors.', e);
                        reject(e);
                    });

            });

        });
        req.on('error', e => {
            logFailedDataFetch(e.message);
            reject(e);
        });
        req.end();

    });

}


function loadPastMessages() {
    return JSON.parse(fs.readFileSync(allMessagesFilename, 'utf-8'));
}


function findNewMessages(currentMessages, pastMessages) {
    return currentMessages.filter(currentMessage => !pastMessages.some(pastMessage => pastMessage.id === currentMessage.id));
}


async function processNewMessages(pastMessages, newMessages) {

    if (newMessages.length === 0) {
        logger.info('No new messages to process.');
        return Promise.resolve();
    }

    logNewMessages(newMessages)
    recordNewMessages(pastMessages, newMessages);

    return processNewMessagesDelayed(newMessages);

}


async function processMessageUpdates(currentMessages) {
    logger.info('Checking for message updates');
    return processMessageUpdatesDelayed(currentMessages);
}


function recordNewMessages(pastMessages, newMessages) {
    const allMessages = pastMessages.concat(...newMessages);
    const strMessages = JSON.stringify(allMessages, null, 2);
    fs.writeFileSync(allMessagesFilename, strMessages);
}


async function processNewMessagesDelayed(messages) {

    return new Promise(resolve => {
        messages
            .sort((a, b) => a.createdDate > b.createdDate ? -1 : 0)
            .reverse()
            .forEach(delayProcessMessage(processNewMessage, PROCESS_DELAY_SECONDS * 1000));
        delayProcessMessage(resolve, PROCESS_DELAY_SECONDS * 1000)(null, messages.length);
    });

}


async function processMessageUpdatesDelayed(messages) {

    return new Promise(resolve => {

        let index = 0;
        messages
            .sort((a, b) => a.lastUpdated > b.lastUpdated ? -1 : 0)
            .reverse()
            .forEach(message => {

                const filepath = `${messagesDir}/message-${message.id}.json`;
                if (fs.existsSync(filepath)) {
                    const oldMessage = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
                    if (message.lastUpdated > oldMessage.lastUpdated) {
                        delayProcessMessage(processMessageUpdate, PROCESS_DELAY_SECONDS * 1000)(oldMessage, index);
                        index++;
                    }
                }

            });

        delayProcessMessage(resolve, PROCESS_DELAY_SECONDS * 1000)(null, index);

    });

}


function delayProcessMessage(fn, delay) {
    return (message, i) => setTimeout(() => fn(message), i * delay);
}


async function processNewMessage(message) {

    let messageDetails = null;
    try {
        messageDetails = await fetchMessageDetails(message);
    } catch (e) {
        return logFailedDetailsFetch(e);
    }

    saveMessageDetailsToFile(messageDetails);
    await saveMessageDetailsToDatabase(messageDetails);

    let imageData = null;
    if (messageDetails.messageImage) {

        try {
            imageData = await fetchImage(messageDetails);
        } catch (e) {
            return logFailedImageFetch(e);
        }

        try {
            await saveImageToFile(messageDetails, imageData);
        } catch (e) {
            return logFailedImageFileSave(e);
        }

        try {
            await saveImageToS3(messageDetails, imageData);
        } catch (e) {
            return logFailedImageS3Save(e);
        }

    }

    if (MAX_QUEUE_SIZE > 0) {
        enqueueNewMessage(messageDetails);
        if (messageDetails.responses.length > 0) {
            enqueueResponseUpdate(messageDetails);
        }
    }

}


async function processMessageUpdate(oldMessage) {

    const messageDetails = await fetchMessageDetails(oldMessage);

    saveMessageDetailsToFile(messageDetails);
    await saveMessageDetailsToDatabase(messageDetails);

    if (oldMessage.responses.length < messageDetails.responses.length) {
        const newResponsesCount = messageDetails.responses.length - oldMessage.responses.length;
        logger.info(`${newResponsesCount} new response(s) in message "${messageDetails.id}" `);
        if (MAX_QUEUE_SIZE > 0) {
            enqueueResponseUpdate(messageDetails);
        }
    }

}


async function fetchMessageDetails(message) {

    logger.info(`Fetching details for message "${message.id}"`);

    return new Promise((resolve, reject) => {

        const req = https.get(`${tenantBaseUrl}?format=json&action=detail&id=${message.id}`, res => {

            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }

            let body = '';

            res.on('data', d => body += d);
            res.on('end', () => {

                // Get the messages that are currently available
                const messageDetails = JSON.parse(body);
                if (messageDetails && messageDetails.length > 0) {
                    logger.info(`Received details for message "${message.id}"`);
                    resolve(messageDetails[0]);
                }

                return reject(`No details for message "${message.id}"`);

            });

        });
        req.on('error', e => reject(e.message));
        req.end();

    });

}


function saveMessageDetailsToFile(message) {
    logger.info(`Saving details for message "${message.id}" to file`);
    const filename = `message-${message.id}.json`;
    const strMessage = JSON.stringify(message, null, 2);
    fs.writeFileSync(`${messagesDir}/${filename}`, strMessage);
}


async function saveMessageDetailsToDatabase(message) {
    logger.info(`Saving details for message "${message.id}" to database`);
    const location = getMessageLocation(message);
    const doc = { ...message, tenantId, location };
    await messagesCollection.replaceOne({ id: message.id }, doc, { upsert: true })
}


async function fetchImage(messageDetails) {

    logger.info(`Fetching image of message "${messageDetails.id}"`)

    return new Promise((resolve, reject) => {

        const imageId = messageDetails.messageImage.id;
        const req = https.get(`${baseUrl}/IWImageLoader?mediaId=${imageId}`, (res) => {

            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }

            const imageData = [];

            res.on('data', d => imageData.push(d));
            res.on('end', () => {
                logger.info(`Received image of message "${messageDetails.id}"`);
                resolve(Buffer.concat(imageData));
            });

        });
        req.on('error', () => reject(e.message));
        req.end();

    });

}


function saveImageToFile(messageDetails, imageDataBuffer) {
    logger.info(`Saving image of message "${messageDetails.id}" to file`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${imagesDir}/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    fs.writeFileSync(filename, imageDataBuffer);
}


async function saveImageToS3(messageDetails, imageDataBuffer) {
    logger.info(`Saving image of message "${messageDetails.id}" to S3`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    return s3.upload({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `tenants/${tenantId}/images/${filename}`,
        Body: imageDataBuffer,
    }).promise();
}


function enqueueNewMessage(messageDetails) {
    const currentQueueSize = fs.readdirSync(queueNewMessagesDir).length;
    if (currentQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving message "${messageDetails.id}" into new messages queue`);
        fs.writeFileSync(`${queueNewMessagesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue new message "${messageDetails.id}". Queue is full!`);
    }
}


function enqueueResponseUpdate(messageDetails) {
    const currentQueueSize = fs.readdirSync(queueResponseUpdatesDir).length;
    if (currentQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving response update for message "${messageDetails.id}" into response update queue`);
        fs.writeFileSync(`${queueResponseUpdatesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue response update for message "${messageDetails.id}". Queue is full!`);
    }
}


async function archiveOldMessages(pastMessages, currentMessages) {

    const thresholdDate = dateFns.endOfISOWeek(dateFns.subMonths(new Date(), 6));
    const allMessages = loadPastMessages();
    const messagesToArchive = allMessages.filter(m1 => {
        const messageNotInFetchResult = currentMessages.every(m2 => m2.id !== m1.id);
        const messageTooOld = dateFns.isBefore(m1.lastUpdated, thresholdDate)
        return messageNotInFetchResult || messageTooOld;
    });

    const allImageFiles = fs.readdirSync(imagesDir);
    messagesToArchive.forEach(message => {

        // Move image files
        const imageFiles = allImageFiles.filter(file => file.startsWith(`${message.id}-`));
        imageFiles.forEach(
            imageFile => fs.renameSync(`${imagesDir}/${imageFile}`, `${archiveImagesDir}/${imageFile}`)
        );

        // Move message file
        if (fs.existsSync(`${messagesDir}/message-${message.id}.json`)) {
            fs.renameSync(
                `${messagesDir}/message-${message.id}.json`,
                `${archiveMessagesDir}/message-${message.id}.json`
            );
        }

    });

}


function logFailedDataFetch(errorMessage) {
    const text = `Fetching data failed: ${errorMessage}`;
    logger.error(text);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedDetailsFetch(errorMessage) {
    const text = `Fetching details failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedImageFetch(errorMessage) {
    const text = `Fetching image failed: ${errorMessage}`;
    logger.error(text);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedImageFileSave(errorMessage) {
    const text = `Saving image to file failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedImageS3Save(errorMessage) {
    const text = `Saving image to S3 failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logNewMessages(messages) {
    const text = `Found new messages: ${messages.length}`;
    logger.info(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function sendToSlackChannel(message) {

    const text = `${tenantName}/${tenantId}: ${message}`;
    const strData = JSON.stringify({ text });
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': strData.length
        }
    };
    const req = https.request(
        SLACK_WEBHOOK_URL,
        options,
        res => {
            if (res.statusCode !== 200) {
                logger.error(`Failed to send message to Slack channel: ${text}`)
            }
        }
    );

    req.on('error', error => console.error(error));
    req.write(strData);
    req.end();

}
