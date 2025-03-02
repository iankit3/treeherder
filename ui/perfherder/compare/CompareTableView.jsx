import React from 'react';
import PropTypes from 'prop-types';
import { Alert, Col, Row, Container } from 'reactstrap';
import { Link } from 'react-router-dom';

import ErrorMessages from '../../shared/ErrorMessages';
import {
  genericErrorMessage,
  errorMessageClass,
} from '../../helpers/constants';
import { compareDefaultTimeRange, phTimeRanges } from '../constants';
import ErrorBoundary from '../../shared/ErrorBoundary';
import { getData } from '../../helpers/http';
import {
  createApiUrl,
  perfSummaryEndpoint,
  createQueryParams,
} from '../../helpers/url';
import { getFrameworkData } from '../helpers';
import TruncatedText from '../../shared/TruncatedText';
import LoadingSpinner from '../../shared/LoadingSpinner';
import { scrollToLine } from '../../helpers/utils';

import RevisionInformation from './RevisionInformation';
import CompareTableControls from './CompareTableControls';
import NoiseTable from './NoiseTable';

export default class CompareTableView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      compareResults: new Map(),
      testsNoResults: null,
      testsWithNoise: [],
      failureMessages: [],
      loading: false,
      timeRange: this.setTimeRange(),
      framework: getFrameworkData(this.props),
      title: '',
    };
  }

  componentDidMount() {
    const { compareData, location } = this.props;

    if (
      compareData &&
      compareData.size > 0 &&
      location.pathname === '/compare'
    ) {
      this.setState({ compareResults: compareData });
    } else {
      this.getPerformanceData();
    }
  }

  componentDidUpdate(prevProps) {
    const { loading } = this.state;
    const { hashFragment } = this.props;

    if (this.props.location.search !== prevProps.location.search) {
      this.getPerformanceData();
    }

    if (!loading && hashFragment) {
      scrollToLine(hashFragment, 100);
    }
  }

  setTimeRange = () => {
    const { selectedTimeRange, originalRevision } = this.props.validated;

    if (originalRevision) {
      return null;
    }

    let timeRange;
    if (selectedTimeRange) {
      timeRange = phTimeRanges.find(
        timeRange => timeRange.value === parseInt(selectedTimeRange, 10),
      );
    }

    return timeRange || compareDefaultTimeRange;
  };

  getPerformanceData = async () => {
    const { getQueryParams, hasSubtests, getDisplayResults } = this.props;
    const {
      originalProject,
      originalRevision,
      newProject,
      newRevision,
    } = this.props.validated;
    const { framework, timeRange, failureMessages } = this.state;

    this.setState({ loading: true });

    const [originalParams, newParams] = getQueryParams(timeRange, framework);

    const [originalResults, newResults] = await Promise.all([
      getData(createApiUrl(perfSummaryEndpoint, originalParams)),
      getData(createApiUrl(perfSummaryEndpoint, newParams)),
    ]);

    if (originalResults.failureStatus) {
      return this.setState({
        failureMessages: [originalResults.data, ...failureMessages],
        loading: false,
      });
    }

    if (newResults.failureStatus) {
      return this.setState({
        failureMessages: [newResults.data, ...failureMessages],
        loading: false,
      });
    }

    const data = [...originalResults.data, ...newResults.data];
    let rowNames;
    let tableNames;
    let title;

    if (!data.length) {
      return this.setState({ loading: false });
    }

    if (hasSubtests) {
      let subtestName = data[0].name.split(' ');
      subtestName.splice(1, 1);
      subtestName = subtestName.join(' ');

      title = `${data[0].platform}: ${subtestName}`;
      tableNames = [subtestName];
      rowNames = [...new Set(data.map(item => item.test))].sort();
    } else {
      tableNames = [...new Set(data.map(item => item.name))].sort();
      rowNames = [...new Set(data.map(item => item.platform))].sort();
    }

    const text = originalRevision
      ? `${originalRevision} (${originalProject})`
      : originalProject;

    window.document.title =
      title || `Comparison between ${text} and ${newRevision} (${newProject})`;

    const updates = getDisplayResults(originalResults.data, newResults.data, {
      ...this.state,
      ...{ tableNames, rowNames },
    });
    updates.title = title;
    return this.setState(updates);
  };

  updateFramework = selection => {
    const { updateParams } = this.props.validated;
    const { frameworks } = this.props;

    const framework = frameworks.find(item => item.name === selection);

    updateParams({ framework: framework.id });
    this.setState({ framework }, () => this.getPerformanceData());
  };

  updateTimeRange = selection => {
    const { updateParams } = this.props.validated;
    const timeRange = phTimeRanges.find(item => item.text === selection);

    updateParams({ selectedTimeRange: timeRange.value });
    this.setState({ timeRange }, () => this.getPerformanceData());
  };

  notifyFailure = (message, severity) => {
    const { failureMessages } = this.state;
    if (severity === 'danger') {
      this.setState({
        failureMessages: [message, ...failureMessages],
      });
    }
  };

  render() {
    const {
      originalProject,
      newProject,
      originalRevision,
      newRevision,
      originalResultSet,
      newResultSet,
    } = this.props.validated;

    const {
      filterByFramework,
      hasSubtests,
      onPermalinkClick,
      frameworks,
    } = this.props;
    const {
      compareResults,
      loading,
      failureMessages,
      testsWithNoise,
      timeRange,
      testsNoResults,
      title,
      framework,
    } = this.state;

    const frameworkNames =
      frameworks && frameworks.length ? frameworks.map(item => item.name) : [];

    const compareDropdowns = [];

    const params = {
      originalProject,
      newProject,
      newRevision,
      framework: framework.id,
    };

    if (originalRevision) {
      params.originalRevision = originalRevision;
    } else if (timeRange) {
      params.selectedTimeRange = timeRange.value;
    }

    if (filterByFramework) {
      compareDropdowns.push({
        options: frameworkNames,
        selectedItem: framework.name,
        updateData: framework => this.updateFramework(framework),
      });
    }
    if (!originalRevision) {
      compareDropdowns.push({
        options: phTimeRanges.map(option => option.text),
        selectedItem: timeRange.text,
        updateData: timeRange => this.updateTimeRange(timeRange),
      });
    }

    return (
      <Container fluid className="max-width-default">
        {loading && !failureMessages.length && <LoadingSpinner />}

        <ErrorBoundary
          errorClasses={errorMessageClass}
          message={genericErrorMessage}
        >
          <React.Fragment>
            {hasSubtests && (
              <Link
                to={{
                  pathname: '/compare',
                  search: createQueryParams(params),
                }}
              >
                Back to all tests and platforms
              </Link>
            )}

            <div className="mx-auto">
              <Row className="justify-content-center">
                <Col sm="8" className="text-center">
                  {failureMessages.length !== 0 && (
                    <ErrorMessages errorMessages={failureMessages} />
                  )}
                </Col>
              </Row>
              {newRevision && newProject && (originalRevision || timeRange) && (
                <Row>
                  <Col sm="12" className="text-center pb-1">
                    <h1>
                      {hasSubtests
                        ? `${title} subtest summary`
                        : 'Perfherder Compare Revisions'}
                    </h1>
                    <RevisionInformation
                      originalProject={originalProject}
                      originalRevision={originalRevision}
                      originalResultSet={originalResultSet}
                      newProject={newProject}
                      newRevision={newRevision}
                      newResultSet={newResultSet}
                      selectedTimeRange={timeRange}
                    />
                  </Col>
                </Row>
              )}

              {testsNoResults && (
                <Row className="pt-5 justify-content-center">
                  <Col small="12" className="px-0 max-width-default">
                    <Alert color="warning">
                      <TruncatedText
                        title="Tests without results: "
                        maxLength={174}
                        text={testsNoResults}
                      />
                    </Alert>
                  </Col>
                </Row>
              )}

              <CompareTableControls
                {...this.props}
                dropdownOptions={compareDropdowns}
                updateState={state => this.setState(state)}
                onPermalinkClick={onPermalinkClick}
                compareResults={compareResults}
                isBaseAggregate={!originalRevision}
                notify={this.notifyFailure}
                showTestsWithNoise={
                  testsWithNoise.length > 0 && (
                    <Row>
                      <Col sm="12" className="text-center">
                        <NoiseTable
                          testsWithNoise={testsWithNoise}
                          hasSubtests={hasSubtests}
                        />
                      </Col>
                    </Row>
                  )
                }
              />
            </div>
          </React.Fragment>
        </ErrorBoundary>
      </Container>
    );
  }
}

CompareTableView.propTypes = {
  validated: PropTypes.shape({
    originalResultSet: PropTypes.shape({}),
    newResultSet: PropTypes.shape({}),
    newRevision: PropTypes.string,
    originalProject: PropTypes.string,
    newProject: PropTypes.string,
    originalRevision: PropTypes.string,
    selectedTimeRange: PropTypes.string,
    updateParams: PropTypes.func.isRequired,
    originalSignature: PropTypes.string,
    newSignature: PropTypes.string,
    framework: PropTypes.string,
  }),
  user: PropTypes.shape({}).isRequired,
  dateRangeOptions: PropTypes.oneOfType([PropTypes.shape({}), PropTypes.bool]),
  filterByFramework: PropTypes.oneOfType([PropTypes.shape({}), PropTypes.bool]),
  getDisplayResults: PropTypes.func.isRequired,
  getQueryParams: PropTypes.func.isRequired,
  hasSubtests: PropTypes.bool,
  onPermalinkClick: PropTypes.func,
  hashFragment: PropTypes.string,
  frameworks: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
};

CompareTableView.defaultProps = {
  dateRangeOptions: null,
  filterByFramework: null,
  validated: PropTypes.shape({}),
  hasSubtests: false,
  hashFragment: '',
  onPermalinkClick: undefined,
};
