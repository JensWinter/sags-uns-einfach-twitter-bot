'use strict';

const fs = require('fs');
const dateFns = require('date-fns');

const allMessagesText = fs.readFileSync('./all-messages.json');
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
console.log(tweetText);

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
