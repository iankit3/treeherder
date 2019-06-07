import pick from 'lodash/pick';
import keyBy from 'lodash/keyBy';
// import isEqual from 'lodash/isEqual';
import max from 'lodash/max';

import { parseQueryParams } from '../../../helpers/url';
import {
  getAllUrlParams,
  getQueryString,
  getUrlParam,
  setLocation,
  setUrlParam,
} from '../../../helpers/location';
// import { reloadOnChangeParameters } from '../../../helpers/filter';
import PushModel from '../../../models/push';
import { isUnclassifiedFailure } from '../../../helpers/job';
import JobModel from '../../../models/job';
import { thEvents } from '../../../helpers/constants';

const FETCH_PUSHES = 'FETCH_PUSHES';
const REQUEST_PUSHES = 'REQUEST_PUSHES';
const FETCH_NEXT_PUSHES = 'FETCH_NEXT_PUSHES';
const FETCH_NEW_JOBS = 'FETCH_NEW_JOBS';
const RECALCULATE_UNCLASSIFIED_COUNTS = 'RECALCULATE_UNCLASSIFIED_COUNTS';
const UPDATE_JOB_MAP = 'UPDATE_JOB_MAP';
// const UPDATE_URL_FROM_CHANGE = 'UPDATE_URL_FROM_CHANGE';

const DEFAULT_PUSH_COUNT = 10;
// Keys that, if present on the url, must be passed into the push
// polling endpoint
const PUSH_POLLING_KEYS = ['tochange', 'enddate', 'revision', 'author'];
const PUSH_FETCH_KEYS = [...PUSH_POLLING_KEYS, 'fromchange', 'startdate'];
// const PUSH_POLL_INTERVAL = 60000;

export const fetchPushes = count => ({
  type: FETCH_PUSHES,
  count,
});

export const fetchNextPushes = countPinnedJobs => ({
  type: FETCH_NEXT_PUSHES,
  countPinnedJobs,
});

export const fetchNewJobs = setSelectedJob => ({
  type: FETCH_NEW_JOBS,
  setSelectedJob,
});

export const recalculateUnclassifiedCounts = filterModel => ({
  type: RECALCULATE_UNCLASSIFIED_COUNTS,
  filterModel,
});

export const updateJobMap = jobs => ({
  type: UPDATE_JOB_MAP,
  jobs,
});

export const requestPushes = () => ({
  type: REQUEST_PUSHES,
});

const getRevisionTips = pushList => {
  return {
    revisionTips: pushList.map(push => ({
      revision: push.revision,
      author: push.author,
      title: push.revisions[0].comments.split('\n')[0],
    })),
  };
};

const addPushes = (data, pushList, jobMap) => {
  if (data.results.length > 0) {
    const pushIds = pushList.map(push => push.id);
    const newPushList = [
      ...pushList,
      ...data.results.filter(push => !pushIds.includes(push.id)),
    ];
    newPushList.sort((a, b) => b.push_timestamp - a.push_timestamp);
    const oldestPushTimestamp =
      newPushList[newPushList.length - 1].push_timestamp;

    console.log('newPushList', newPushList);
    return {
      pushList: newPushList,
      oldestPushTimestamp,
      ...recalculateUnclassifiedCounts(jobMap),
      ...getRevisionTips(newPushList),
    };
  }
  return {};
};

const doFetchPushes = async (
  count = DEFAULT_PUSH_COUNT,
  pushList,
  jobMap,
  notify,
  oldestPushTimestamp,
) => {
  return function(dispatch) {
    dispatch(requestPushes());

    // Only pass supported query string params to this endpoint.
    const options = {
      ...pick(parseQueryParams(getQueryString()), PUSH_FETCH_KEYS),
      count,
    };

    if (oldestPushTimestamp) {
      // If we have an oldestTimestamp, then this isn't our first fetch,
      // we're fetching more pushes.  We don't want to limit this fetch
      // by the current ``fromchange`` or ``tochange`` value.  Deleting
      // these params here do not affect the params on the location bar.
      delete options.fromchange;
      delete options.tochange;
      options.push_timestamp__lte = oldestPushTimestamp;
    }

    console.log('in the thunk');

    PushModel.getList(options).then(({ data, failureStatus }) => {
      if (!failureStatus) {
        return {
          ...addPushes(
            data.results.length ? data : { results: [] },
            pushList,
            jobMap,
          ),
          loadingData: false,
        };
      }
      notify('Error retrieving push data!', 'danger', { sticky: true });
      return {};
    });
    return {};
  };
};

// TODO: Can we do away with reloading entirely?
// const getNewReloadTriggerParams = () => {
//   const params = parseQueryParams(getQueryString());
//
//   return reloadOnChangeParameters.reduce(
//     (acc, prop) => (params[prop] ? { ...acc, [prop]: params[prop] } : acc),
//     {},
//   );
// };

/**
 * Get the next batch of pushes based on our current offset.
 */
const doFetchNextPushes = count => {
  const params = getAllUrlParams();

  this.setValue({ loadingPushes: true });
  if (params.has('revision')) {
    // We are viewing a single revision, but the user has asked for more.
    // So we must replace the ``revision`` param with ``tochange``, which
    // will make it just the top of the range.  We will also then get a new
    // ``fromchange`` param after the fetch.
    this.skipNextPageReload = true;
    const revision = params.get('revision');
    params.delete('revision');
    params.set('tochange', revision);
    setLocation(params);
  } else if (params.has('startdate')) {
    // We are fetching more pushes, so we don't want to limit ourselves by
    // ``startdate``.  And after the fetch, ``startdate`` will be invalid,
    // and will be replaced on the location bar by ``fromchange``.
    this.skipNextPageReload = true;
    setUrlParam('startdate', null);
  }
  return fetchPushes(count).then(this.updateUrlFromchange);
};

const doUpdateJobMap = jobList => {
  const { jobMap, pushList } = this.state;

  if (jobList.length) {
    // lodash ``keyBy`` is significantly faster than doing a ``reduce``
    this.setValue({
      jobMap: { ...jobMap, ...keyBy(jobList, 'id') },
      jobsLoaded: pushList.every(push => push.jobsLoaded),
      pushList: [...pushList],
    });
  }
};

// TODO: Could this be done elsewhere?  Where it's called?  Or perhaps in App.
// Even better: can we avoid having to do a page reload at all?
// const updateUrlFromchange = pushList => {
//   // since we fetched more pushes, we need to persist the push state in the URL.
//   const updatedLastRevision = pushList[pushList.length - 1].revision;
//
//   if (getUrlParam('fromchange') !== updatedLastRevision) {
//     this.skipNextPageReload = true;
//     setUrlParam('fromchange', updatedLastRevision);
//   }
// };

/**
 * Loops through the map of unclassified failures and checks if it is
 * within the enabled tiers and if the job should be shown. This essentially
 * gives us the difference in unclassified failures and, of those jobs, the
 * ones that have been filtered out
 */
const doRecalculateUnclassifiedCounts = (jobMap, filterModel) => {
  const tiers = filterModel.urlParams.tier || [];
  let allUnclassifiedFailureCount = 0;
  let filteredUnclassifiedFailureCount = 0;

  Object.values(jobMap).forEach(job => {
    if (isUnclassifiedFailure(job)) {
      if (tiers.includes(String(job.tier))) {
        if (filterModel.showJob(job)) {
          filteredUnclassifiedFailureCount++;
        }
        allUnclassifiedFailureCount++;
      }
    }
  });
  return {
    allUnclassifiedFailureCount,
    filteredUnclassifiedFailureCount,
  };
};

const getLastModifiedJobTime = () => {
  const { jobMap } = this.state;
  const latest =
    max(Object.values(jobMap).map(job => new Date(`${job.last_modified}Z`))) ||
    new Date();

  latest.setSeconds(latest.getSeconds() - 3);
  return latest;
};

const doFetchNewJobs = async (setSelectedJob, pushList) => {
  if (!pushList.length) {
    // If we have no pushes, then no need to poll for jobs.
    return;
  }
  const pushIds = pushList.map(push => push.id);
  const lastModified = getLastModifiedJobTime();
  const jobList = await JobModel.getList(
    {
      push_id__in: pushIds.join(','),
      last_modified__gt: lastModified.toISOString().replace('Z', ''),
    },
    { fetch_all: true },
  );
  // break the jobs up per push
  const jobs = jobList.reduce((acc, job) => {
    const pushJobs = acc[job.push_id] ? [...acc[job.push_id], job] : [job];
    return { ...acc, [job.push_id]: pushJobs };
  }, {});
  // If a job is selected, and one of the jobs we just fetched is the
  // updated version of that selected job, then send that with the event.
  const selectedJobId = getUrlParam('selectedJob');
  const updatedSelectedJob = selectedJobId
    ? jobList.find(job => job.id === parseInt(selectedJobId, 10))
    : null;

  window.dispatchEvent(
    new CustomEvent(thEvents.applyNewJobs, {
      detail: { jobs },
    }),
  );
  if (updatedSelectedJob) {
    setSelectedJob(updatedSelectedJob);
  }
};

const initialState = {
  allShownJobs: [],
  pushList: [],
  jobMap: {},
  revisionTips: [],
  jobsLoaded: false,
  loadingPushes: true,
  oldestPushTimestamp: null,
  latestJobTimestamp: null,
  allUnclassifiedFailureCount: 0,
  filteredUnclassifiedFailureCount: 0,
};

export const reducer = (state = initialState, action) => {
  const { count, notify, jobs } = action;
  const { oldestPushTimestamp, setSelectedJob, pushList, jobMap } = state;
  // console.log('reducer', state, action.type);
  switch (action.type) {
    case FETCH_PUSHES:
      return {
        ...state,
        ...doFetchPushes(count, pushList, jobMap, notify, oldestPushTimestamp),
      };
    case REQUEST_PUSHES:
      return { ...state, loadingPushes: true };
    case FETCH_NEXT_PUSHES:
      return { ...state, ...doFetchNextPushes(count) };
    case FETCH_NEW_JOBS:
      return { ...state, ...doFetchNewJobs(setSelectedJob, pushList) };
    case RECALCULATE_UNCLASSIFIED_COUNTS:
      return { ...state, ...doRecalculateUnclassifiedCounts(notify, jobMap) };
    case UPDATE_JOB_MAP:
      return { ...state, ...doUpdateJobMap(jobs) };
    default:
      return state;
  }
};
