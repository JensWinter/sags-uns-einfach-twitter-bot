'use strict';

const fs = require('fs');
const dateFns = require('date-fns');
const winston = require('winston');

require('dotenv').config();


const config = initArgs();

const tenantId = config.tenantId;
const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantId}`;
const messagesDir = `${tenantDir}/messages`;
const allMessagesFilename = `${messagesDir}/all-messages.json`;
const queueStatisticsUpdatesDir = `${tenantDir}/queue_statistics_updates`;

const logger = initLogger();

const MAX_QUEUE_SIZE = config.maxQueueSize;


prepareTenantDirectory();


createStatsTweet();


function initArgs() {

    const yargs = require('yargs/yargs');
    const { hideBin } = require('yargs/helpers');
    const argv = yargs(hideBin(process.argv))
        .options({
            'h': {
                alias: 'help'
            },
            'c': {
                alias: 'config',
                demandOption: true,
                type: 'string',
            }
        })
        .coerce('config', arg => JSON.parse(fs.readFileSync(arg, 'utf8')))
        .version()
        .argv;

    return argv.config;

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
            new winston.transports.File({ filename: `${tenantDir}/output-create-stats.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function prepareTenantDirectory() {
    if (!fs.existsSync(messagesDir)) {
        logger.info('Creating messages directory.')
        fs.mkdirSync(messagesDir, { recursive: true });
    }
    if (!fs.existsSync(allMessagesFilename)) {
        logger.info('Creating messages file.')
        fs.writeFileSync(allMessagesFilename, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(queueStatisticsUpdatesDir)) {
        logger.info('Creating weekly statistics queue directory.')
        fs.mkdirSync(queueStatisticsUpdatesDir, { recursive: true });
    }
}


function createStatsTweet() {

    const allMessagesText = fs.readFileSync(allMessagesFilename);
    const allMessages = JSON.parse(allMessagesText);

    const today = new Date();
    const startOfThisWeek = dateFns.startOfISOWeek(today);
    const lowerBoundWeek = dateFns.subWeeks(startOfThisWeek, 10);
    const createdDates = allMessages
        .map(m => {
            const createdDate = dateFns.fromUnixTime(m.createdDate / 1000);
            return {
                createdDate,
                week: dateFns.getISOWeek(createdDate, { weekStartsOn: 1 }),
                year: dateFns.getISOWeekYear(createdDate)
            };
        })
        .filter(m => dateFns.isAfter(m.createdDate, lowerBoundWeek))
        .sort((a, b) => a.year === b.year ? b.week - a.week : b.year - a.year);

    const createdDatesGrouped = createdDates.reduce(
        (entryMap, e) => {
            const key = `${e.year}-${e.week.toString().padStart(2, '0')}`;
            return entryMap.set(key, [...entryMap.get(key) || [], e]);
        },
        new Map()
    );
    const chartLines = Array
        .from(createdDatesGrouped.values())
        .map(group => ({
            year: group[0].year,
            week: group[0].week,
            cnt: group.length
        }))
        .map(entry => {
            const fullBlocksCnt = Math.min(15, Math.round(entry.cnt / 10));
            const halfBlocksCnt = Math.max(0, 15 - fullBlocksCnt);
            const chartLine = '▓'.repeat(fullBlocksCnt) + ''.repeat(halfBlocksCnt);
            return 'KW ' + getWeekBlockStr(entry.week) + ' ' + chartLine + '  ' + entry.cnt;
        })
        .slice(0, 8);

    const tweetText = `Neue MD-Melder-Einträge

${chartLines.join('\n')}

#MDMelderStats`;

    enqueueStatisticsUpdate(tweetText, today);

}


function getWeekBlockStr(week) {
    const weekStr = week >= 10 ? `${week}` : `    ${week}`;
    return [...weekStr]
        .map(char => {
            switch (char) {
                case '0': return '０';
                case '1': return '１';
                case '2': return '２';
                case '3': return '３';
                case '4': return '４';
                case '5': return '５';
                case '6': return '６';
                case '7': return '７';
                case '8': return '８';
                case '9': return '９';
                default: return char;
            }
        })
        .join('');
}


function enqueueStatisticsUpdate(text, date) {
    const dateStr = dateFns.formatISO(date, { representation: 'date' });
    const currentQueueSize = fs.readdirSync(queueStatisticsUpdatesDir).length;
    if (currentQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving statistics for "${dateStr}" into queue`);
        fs.writeFileSync(`${queueStatisticsUpdatesDir}/stats-${dateStr}.txt`, text);
    } else {
        logger.warn(`Didn't queue statistics "${messageDetails.id}". Queue is full!`);
    }
}
