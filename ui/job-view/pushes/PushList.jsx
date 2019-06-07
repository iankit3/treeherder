import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import intersection from 'lodash/intersection';

import ErrorBoundary from '../../shared/ErrorBoundary';
import { withPinnedJobs } from '../context/PinnedJobs';
import { notify } from '../redux/stores/notifications';
import {
  clearSelectedJob,
  setSelectedJobFromQueryString,
} from '../redux/stores/selectedJob';
import { fetchPushes, fetchNextPushes } from '../redux/stores/pushes';

import Push from './Push';
import PushLoadErrors from './PushLoadErrors';

class PushList extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      notificationSupported: 'Notification' in window,
    };
  }

  componentDidMount() {
    this.props.fetchPushes();
  }

  componentDidUpdate(prevProps) {
    const {
      notify,
      jobMap,
      jobsLoaded,
      setSelectedJobFromQueryString,
    } = this.props;

    if (jobsLoaded !== prevProps.jobsLoaded) {
      setSelectedJobFromQueryString(notify, jobMap);
    }
  }

  setWindowTitle() {
    const { allUnclassifiedFailureCount, repoName } = this.props;

    document.title = `[${allUnclassifiedFailureCount}] ${repoName}`;
  }

  clearIfEligibleTarget(target) {
    // Target must be within the "push" area, but not be a dropdown-item or
    // a button/btn.
    // This will exclude the JobDetails and navbars.
    const globalContent = document.getElementById('th-global-content');
    const { clearSelectedJob, countPinnedJobs } = this.props;
    const isEligible =
      globalContent.contains(target) &&
      target.tagName !== 'A' &&
      target.closest('button') === null &&
      !intersection(target.classList, ['btn', 'dropdown-item']).length;

    if (isEligible) {
      clearSelectedJob(countPinnedJobs);
    }
  }

  render() {
    const {
      user,
      repoName,
      revision,
      currentRepo,
      filterModel,
      pushList,
      loadingPushes,
      fetchNextPushes,
      getAllShownJobs,
      jobsLoaded,
      duplicateJobsVisible,
      groupCountsExpanded,
      pushHealthVisibility,
    } = this.props;
    const { notificationSupported } = this.state;
    const { isLoggedIn } = user;

    if (!revision) {
      this.setWindowTitle();
    }
    console.log('pushList', pushList);

    return (
      <div onClick={evt => this.clearIfEligibleTarget(evt.target)}>
        {jobsLoaded && <span className="hidden ready" />}
        {repoName &&
          pushList.map(push => (
            <ErrorBoundary
              errorClasses="pl-2 border-top border-bottom border-dark d-block"
              message={`Error on push with revision ${push.revision}: `}
              key={push.id}
            >
              <Push
                push={push}
                isLoggedIn={isLoggedIn || false}
                currentRepo={currentRepo}
                repoName={repoName}
                filterModel={filterModel}
                notificationSupported={notificationSupported}
                duplicateJobsVisible={duplicateJobsVisible}
                groupCountsExpanded={groupCountsExpanded}
                isOnlyRevision={push.revision === revision}
                pushHealthVisibility={pushHealthVisibility}
                getAllShownJobs={getAllShownJobs}
              />
            </ErrorBoundary>
          ))}
        {loadingPushes && (
          <div
            className="progress active progress-bar progress-bar-striped"
            role="progressbar"
          />
        )}
        {pushList.length === 0 && !loadingPushes && (
          <PushLoadErrors
            loadingPushes={loadingPushes}
            currentRepo={currentRepo}
            repoName={repoName}
            revision={revision}
          />
        )}
        <div className="card card-body get-next">
          <span>get next:</span>
          <div className="btn-group">
            {[10, 20, 50].map(count => (
              <div
                className="btn btn-light-bordered"
                onClick={() => fetchNextPushes(count)}
                key={count}
              >
                {count}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
}

PushList.propTypes = {
  repoName: PropTypes.string.isRequired,
  user: PropTypes.object.isRequired,
  filterModel: PropTypes.object.isRequired,
  pushList: PropTypes.array.isRequired,
  fetchNextPushes: PropTypes.func.isRequired,
  fetchPushes: PropTypes.func.isRequired,
  loadingPushes: PropTypes.bool.isRequired,
  jobsLoaded: PropTypes.bool.isRequired,
  duplicateJobsVisible: PropTypes.bool.isRequired,
  groupCountsExpanded: PropTypes.bool.isRequired,
  allUnclassifiedFailureCount: PropTypes.number.isRequired,
  pushHealthVisibility: PropTypes.string.isRequired,
  clearSelectedJob: PropTypes.func.isRequired,
  countPinnedJobs: PropTypes.number.isRequired,
  setSelectedJobFromQueryString: PropTypes.func.isRequired,
  getAllShownJobs: PropTypes.func.isRequired,
  jobMap: PropTypes.object.isRequired,
  notify: PropTypes.func.isRequired,
  revision: PropTypes.string,
  currentRepo: PropTypes.object,
};

PushList.defaultProps = {
  revision: null,
  currentRepo: {},
};

const mapStateToProps = ({
  pushes: {
    loadingPushes,
    jobsLoaded,
    jobMap,
    pushList,
    allUnclassifiedFailureCount,
  },
}) => ({
  loadingPushes,
  jobsLoaded,
  jobMap,
  pushList,
  allUnclassifiedFailureCount,
});

export default connect(
  mapStateToProps,
  {
    notify,
    clearSelectedJob,
    setSelectedJobFromQueryString,
    fetchNextPushes,
    fetchPushes,
  },
)(withPinnedJobs(PushList));
