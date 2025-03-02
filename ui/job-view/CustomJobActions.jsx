import React from 'react';
import { connect } from 'react-redux';
import Select from 'react-select';
import PropTypes from 'prop-types';
import Ajv from 'ajv';
import jsonSchemaDefaults from 'json-schema-defaults';
// js-yaml is missing the `browser` entry from the package definition,
// so we have to explicitly import the dist file otherwise we get the
// node version which pulls in a number of unwanted polyfills. See:
// https://github.com/nodeca/js-yaml/pull/462
import jsyaml from 'js-yaml/dist/js-yaml';
import { slugid } from 'taskcluster-client-web';
import {
  Button,
  Label,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from 'reactstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckSquare } from '@fortawesome/free-regular-svg-icons';

import { formatTaskclusterError } from '../helpers/errorMessage';
import TaskclusterModel from '../models/taskcluster';

import { notify } from './redux/stores/notifications';

class CustomJobActions extends React.PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      ajv: new Ajv({ format: 'full', verbose: true, allErrors: true }),
      decisionTaskId: null,
      originalTaskId: null,
      originalTask: null,
      validate: null,
      actions: null,
      selectedActionOption: '',
      actionOptions: {},
      schema: '',
      payload: '',
    };
  }

  async componentDidMount() {
    const { pushId, job, notify, decisionTaskMap } = this.props;
    const { id: decisionTaskId } = decisionTaskMap[pushId];

    TaskclusterModel.load(decisionTaskId, job).then(results => {
      const {
        originalTask,
        originalTaskId,
        staticActionVariables,
        actions,
      } = results;

      if (actions.length) {
        const actionOptions = actions.map(action => ({
          value: action,
          label: action.title,
        }));

        this.setState(
          {
            originalTask,
            originalTaskId,
            actions,
            staticActionVariables,
            actionOptions,
            selectedActionOption: actionOptions[0],
          },
          () => this.updateSelectedAction(actions[0]),
        );
      } else {
        notify(
          `No actions for task ${decisionTaskId}.  The task may be expired.`,
          'danger',
          {
            sticky: true,
          },
        );
      }
    });
    this.setState({ decisionTaskId });
  }

  onChangeAction = actionOption => {
    if (actionOption.value) {
      this.setState({ selectedActionOption: actionOption });
      this.updateSelectedAction(actionOption.value);
    }
  };

  onChangePayload(payload) {
    this.setState({ payload });
  }

  updateSelectedAction = action => {
    const { ajv } = this.state;

    if (action.schema) {
      this.setState({
        schema: jsyaml.safeDump(action.schema),
        payload: jsyaml.safeDump(jsonSchemaDefaults(action.schema)),
        validate: ajv.compile(action.schema),
      });
    } else {
      this.setState({ schema: null, payload: null, validate: null });
    }
  };

  triggerAction = () => {
    this.setState({ triggering: true });
    const {
      ajv,
      validate,
      payload,
      decisionTaskId,
      originalTaskId,
      originalTask,
      selectedActionOption,
      staticActionVariables,
    } = this.state;
    const { notify } = this.props;
    const action = selectedActionOption.value;

    let input = null;
    if (validate && payload) {
      try {
        input = jsyaml.safeLoad(payload);
      } catch (e) {
        this.setState({ triggering: false });
        notify(`YAML Error: ${e.message}`, 'danger');
        return;
      }
      const valid = validate(input);
      if (!valid) {
        this.setState({ triggering: false });
        notify(ajv.errorsText(validate.errors), 'danger');
        return;
      }
    }

    TaskclusterModel.submit({
      action,
      actionTaskId: slugid(),
      decisionTaskId,
      taskId: originalTaskId,
      task: originalTask,
      input,
      staticActionVariables,
    }).then(
      taskId => {
        this.setState({ triggering: false });
        let message = 'Custom action request sent successfully:';
        let url = `https://tools.taskcluster.net/tasks/${taskId}`;

        // For the time being, we are redirecting specific actions to
        // specific urls that are different than usual. At this time, we are
        // only directing loaner tasks to the loaner UI in the tools site.
        // It is possible that we may make this a part of the spec later.
        const loaners = [
          'docker-worker-linux-loaner',
          'generic-worker-windows-loaner',
        ];
        if (loaners.includes(action.name)) {
          message = 'Visit Taskcluster Tools site to access loaner:';
          url = `${url}/connect`;
        }
        notify(message, 'success', { linkText: 'Open in Taskcluster', url });
        this.close();
      },
      e => {
        notify(formatTaskclusterError(e), 'danger', { sticky: true });
        this.setState({ triggering: false });
        this.close();
      },
    );
  };

  close = () => {
    // prevent closing of dialog while we're triggering
    const { triggering } = this.state;
    const { toggle } = this.props;

    if (!triggering) {
      toggle();
    }
  };

  render() {
    const { isLoggedIn, toggle } = this.props;
    const {
      triggering,
      selectedActionOption,
      schema,
      actions,
      actionOptions,
      payload,
    } = this.state;
    const isOpen = true;
    const selectedAction = selectedActionOption.value;

    return (
      <Modal isOpen={isOpen} toggle={this.close} size="lg">
        <ModalHeader toggle={this.close}>
          Custom Taskcluster Job Actions
        </ModalHeader>
        <ModalBody>
          {!actions && (
            <div>
              <p className="blink"> Getting available actions...</p>
            </div>
          )}
          {!!actions && (
            <div>
              <div className="form-group">
                <Label for="action-select-input">Action</Label>
                <Select
                  inputId="action-select"
                  aria-describedby="selectedActionHelp"
                  value={selectedActionOption}
                  onChange={this.onChangeAction}
                  options={actionOptions}
                  name="Action"
                />
                <p id="selectedActionHelp" className="help-block">
                  {selectedAction.description}
                </p>
                {selectedAction.kind === 'hook' && (
                  <p>
                    This action triggers hook&nbsp;
                    <code>
                      {selectedAction.hookGroupId}/{selectedAction.hookId}
                    </code>
                  </p>
                )}
              </div>
              <div className="row">
                {!!selectedAction.schema && (
                  <React.Fragment>
                    <div className="col-s-12 col-md-6 form-group">
                      <Label for="payload-textarea" className="w-100">
                        Payload
                      </Label>
                      <textarea
                        id="payload-textarea"
                        value={payload}
                        className="form-control pre"
                        rows="10"
                        onChange={evt => this.onChangePayload(evt.target.value)}
                        spellCheck="false"
                      />
                    </div>
                    <div className="col-s-12 col-md-6 form-group">
                      <Label for="schema-textarea" className="w-100">
                        Schema
                      </Label>
                      <textarea
                        id="schema-textarea"
                        className="form-control pre"
                        rows="10"
                        readOnly
                        value={schema}
                      />
                    </div>
                  </React.Fragment>
                )}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {isLoggedIn ? (
            <Button
              color="secondary"
              className={`btn btn-primary-soft ${triggering ? 'disabled' : ''}`}
              onClick={this.triggerAction}
              title={isLoggedIn ? 'Trigger this action' : 'Not logged in'}
            >
              <FontAwesomeIcon
                icon={faCheckSquare}
                className="mr-1"
                title="Check"
              />
              <span>{triggering ? 'Triggering' : 'Trigger'}</span>
            </Button>
          ) : (
            <p className="help-block"> Custom actions require login </p>
          )}
          <Button color="secondary" onClick={toggle}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    );
  }
}

CustomJobActions.propTypes = {
  pushId: PropTypes.number.isRequired,
  isLoggedIn: PropTypes.bool.isRequired,
  notify: PropTypes.func.isRequired,
  toggle: PropTypes.func.isRequired,
  decisionTaskMap: PropTypes.object.isRequired,
  job: PropTypes.object,
};

CustomJobActions.defaultProps = {
  job: null,
};

const mapStateToProps = ({ pushes: { decisionTaskMap } }) => ({
  decisionTaskMap,
});

export default connect(
  mapStateToProps,
  { notify },
)(CustomJobActions);
