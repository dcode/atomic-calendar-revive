import { computeStateDomain, HomeAssistant } from 'custom-card-helpers';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isBetween from 'dayjs/plugin/isBetween';
import { AtomicCalendarReviveEditor } from '../index-editor';
import { atomicCardConfig, EntityConfig } from '../types';
import CalendarDay from './calendar.class';
import EventClass from './event.class';

dayjs.extend(customParseFormat);
dayjs.extend(isBetween);
/**
 * remove Duplicate
 * @return {TemplateResult}
 */
export function removeDuplicates(dayEvents) {
	return dayEvents.filter(
 		(
 			(temp) => (a) =>
 				((k) => !temp[k] && (temp[k] = true))(a.summary + '|' + a.startTime + '|' + a.endTime)
 		)(Object.create(null)),
 	);
}

/**
 * if a time filter is set and event is between the times, return true
 * @param event
 * @param startFilter
 * @param endFilter
 * @returns {boolean}
 */
function checkBetweenTimeFilter(event: EventClass, startFilter, endFilter) {
	const startTimeHour = startFilter.split(':', 1)[0];
	const startTimeMin = startFilter.split(':', 2)[1];
	const startTime = event.startDateTime.set('hour', startTimeHour).set('minutes', startTimeMin);

	const endTimeHour = endFilter.split(':', 1)[0];
	const endTimeMin = endFilter.split(':', 2)[1];
	const endTime = event.startDateTime.set('hour', endTimeHour).set('minutes', endTimeMin);

	return event.startDateTime.isBetween(startTime, endTime, 'minute', '[]');
}

/**
 *
 * @param regex regex that should be checked
 * @param field field to check against
 * @returns
 */
export function checkFilter(str: string, regexList: string) {
	if (typeof regexList != 'undefined' && regexList != '') {
		const regex = new RegExp(regexList, 'i');
		if (regex.test(str)) {
			return true;
		} else {
			return false;
		}
	} else {
		return false;
	}
}

/**
 * group events by the day it's on
 * @param  {Array<EventClass>} events
 * @return {Array<Object>}
 */
export function groupEventsByDay(events) {
	// grouping events by days, returns object with days and events
	const ev: any[] = [].concat(...events);
	const groupsOfEvents = ev.reduce(function (r, a: { daysToSort: number }) {
		r[a.daysToSort] = r[a.daysToSort] || [];
		r[a.daysToSort].push(a);
		return r;
	}, {});

	return Object.keys(groupsOfEvents).map(function (k) {
 		return groupsOfEvents[k];
 	});
}

/**
 * create array for 42 calendar days
 * showLastCalendarWeek
 */
function buildCalendar(config: atomicCardConfig, selectedMonth) {
	const firstDay = selectedMonth.startOf('month');
	const dayOfWeekNumber = firstDay.day();
	const month: any = [];
	let weekShift = 0;
	dayOfWeekNumber - config.firstDayOfWeek! >= 0 ? (weekShift = 0) : (weekShift = 7);
	for (
		let i = config.firstDayOfWeek! - dayOfWeekNumber - weekShift;
		i < 42 - dayOfWeekNumber + config.firstDayOfWeek! - weekShift;
		i++
	) {
		month.push(new CalendarDay(firstDay.add(i, 'day'), i));
	}
	return month;
}

/**
 * Gets events for EventMode specifically, calculations for the dates are different
 * to calendar mode hence the different function
 *
 * @param config Card Configuration
 * @param hass Hassio Options
 * @returns List of Events
 */
export async function getEventMode(config: atomicCardConfig, hass) {
	const daysToShow = config.maxDaysToShow! == 0 ? config.maxDaysToShow! : config.maxDaysToShow! - 1;
	const today = dayjs();
	const start = today.startOf('day').add(config.startDaysAhead!, 'day');
	const end = today.endOf('day').add(daysToShow + config.startDaysAhead!, 'day');
	return await getAllEvents(start, end, config, hass);
}

/**
 * Gets events for CalendarMode specifically, calculations for the dates are different
 * to event mode hence the different function
 *
 * @param config Card Configuration
 * @param hass Hassio Options
 * @param monthToGet Month to collect data from
 */
export async function getCalendarMode(config: atomicCardConfig, hass, selectedMonth) {
	const month = buildCalendar(config, selectedMonth);
	const { events, failedEvents } = await getAllEvents(month[0].date, month[41].date, config, hass);

	// link events to the specific day of the month
	month.map((day: CalendarDay) => {
		events.map((event: EventClass) => {
			if (event.startDateTime.isSame(day.date, 'day')) {
				day.allEvents.push(event);
			}
		});
		return day;
	});
	return month;
}

/**
 * gets events from HA, this is for both Calendar and Event mode
 *
 */
export async function getAllEvents(start: dayjs.Dayjs, end: dayjs.Dayjs, config: atomicCardConfig, hass) {
	// format times correctly
	const today = dayjs();
	const dateFormat = 'YYYY-MM-DDTHH:mm:ss';
	const timeOffset = -dayjs().utcOffset();

	const startTime = start.startOf('day').add(timeOffset, 'minutes').format(dateFormat);
	const endTime = end.endOf('day').add(timeOffset, 'minutes').format(dateFormat);

	// for each calendar entity get all events
	// each entity may be a string of entity id or
	// an object with custom name given with entity id
	const allEvents: any[] = [];
	const failedEvents: any[] = [];

	const calendarEntityPromises: any[] = [];
	config.entities.map((entity) => {
		const calendarEntity = (entity && entity.entity) || entity;

		// get correct end date if maxDaysToShow is set
		const entityEnd =
			typeof entity.maxDaysToShow != 'undefined'
				? today
						.endOf('day')
						.add(entity.maxDaysToShow! - 1 + config.startDaysAhead!, 'day')
						.add(timeOffset, 'minutes')
						.format(dateFormat)
				: endTime;

		const url: string = `calendars/${entity.entity}?start=${startTime}Z&end=${entityEnd}Z`;

		// make all requests at the same time
		calendarEntityPromises.push(
			hass
				.callApi('GET', url)
				.then((rawEvents) => {
					rawEvents.map((event) => {
						event.entity = entity;
						event.calendarEntity = calendarEntity;
						event.hassEntity = hass.states[calendarEntity];
					});
					return rawEvents;
				})
				.then((events) => {
					allEvents.push(...events);
				})
				.catch((error) => {
					failedEvents.push({
						name: entity.name || calendarEntity,
						error,
					});
				}),
		);
	});

	await Promise.all(calendarEntityPromises);
	return { failedEvents, events: processEvents(allEvents, config) };
}

/**
 * Sorts all day events into order of entities
 * @param {Array<Events>} list of events
 * @param {Array<EntityConfig>} all entities for card
 * @return {Promise<Array<EventClass>>}
 */
function sortEventsByEntity(events: EventClass[], entities: EntityConfig[]): any[] {
	const allDayEvents = events.filter((event) => event.isAllDayEvent);
	const otherEvents = events.filter((event) => !event.isAllDayEvent);

	allDayEvents.sort((event1, event2) => {
	  const entity1 = entities.find(
		(entity) => entity.entity === event1.entity.entity_id
	  );
	  const entity2 = entities.find(
		(entity) => entity.entity === event2.entity.entity_id
	  );
	  if (!entity1 || !entity2) {
		return 0;
	  }
	  const index1 = entities.indexOf(entity1);
	  const index2 = entities.indexOf(entity2);
	  if (index1 === index2) {
		return event1.title.localeCompare(event2.title);
	  }
	  return index1 - index2;
	});

	return [...allDayEvents, ...otherEvents];
  }

/**
 * converts all calendar events to CalendarEvent objects
 * @param {Array<Events>} list of raw caldav calendar events
 * @return {Promise<Array<EventClass>>}
 */
export function processEvents(allEvents: any[], config: atomicCardConfig) {
	let newEvents = allEvents.reduce((events, calEvent) => {
		calEvent.originCalendar = config.entities.find((entity) => entity.entity === calEvent.entity.entity);

		const newEvent: EventClass = new EventClass(calEvent, config);

		// if hideDeclined events then filter out
		if (config.hideDeclined && newEvent.isDeclined) {
			return events;
		}

		// if given blocklist value, ignore events that match this title
		if (newEvent.entityConfig.blocklist && newEvent.title) {
			const regex = new RegExp(newEvent.entityConfig.blocklist, 'i');
			if (regex.test(newEvent.title)) {
				return events;
			}
		}

		// if given blocklistLocation value, ignore events that match this location
		if (newEvent.entityConfig.blocklistLocation && newEvent.location) {
			const regex = new RegExp(newEvent.entityConfig.blocklistLocation, 'i');
			if (regex.test(newEvent.location)) {
				return events;
			}
		}

		// if given allowlist value, ignore events that dont match the title
		if (newEvent.entityConfig.allowlist && newEvent.title) {
			const regex = new RegExp(newEvent.entityConfig.allowlist, 'i');
			if (!regex.test(newEvent.title)) {
				return events;
			}
		}

		// if given allowlistLocation value, ignore events that dont match the location
		if (newEvent.entityConfig.allowlistLocation && newEvent.location) {
			const regex = new RegExp(newEvent.entityConfig.allowlistLocation, 'i');
			if (!regex.test(newEvent.location)) {
				return events;
			}
		}

		if (newEvent.entityConfig.startTimeFilter && newEvent.entityConfig.endTimeFilter && !checkBetweenTimeFilter(newEvent, newEvent.entityConfig.startTimeFilter, newEvent.entityConfig.endTimeFilter)) {
        return events;
  }

		/**
		 * if we want to split multi day events and its a multi day event then
		 * get how long then event is and for each day
		 * copy the event, add # of days to start/end time for each event
		 * then add as 'new' event
		 */
		if (config.showMultiDay && newEvent.isMultiDay) {
			const partialEvents = newEvent.splitIntoMultiDay(newEvent);
			events = events.concat(partialEvents);
		} else {
			events.push(newEvent);
		}

		return events;
	}, []);

	// Check if the hideFinishedEvents is set, if it is, remove any events
	// that are already finished
	if (config.hideFinishedEvents) {
		newEvents = newEvents.filter(function (e: EventClass) {
			return e.isFinished == false;
		});
	}

	// if hideDuplicates remove any duplicate events where
	// title, startDateTime and endDateTime match
	if (config.hideDuplicates) {
		newEvents = newEvents.filter(
			(
				(temp) => (a) =>
					((k) => !temp[k] && (temp[k] = true))(a.title + '|' + a.startDateTime + '|' + a.endDateTime)
			)(Object.create(null)),
		);
	}

	// sort events by date starting with soonest
	if (config.sortByStartTime) {
		newEvents.sort((a: EventClass, b: EventClass) => (a.startDateTime.isBefore(b.startDateTime) ? -1 : 1));
	}

	// check if the maxEventCount is set, if it is we will remove any events
	// that go over this limit, unless softLimit is set, in which case we
	// will remove any events over the soft limit
	if (config.maxEventCount && ((!config.softLimit && config.maxEventCount < newEvents.length) ||
 			(config.softLimit && newEvents.length > config.maxEventCount + config.softLimit))) {
		newEvents.length = config.maxEventCount;
	}
	newEvents = sortEventsByEntity(newEvents, config.entities)

	return newEvents;
}
