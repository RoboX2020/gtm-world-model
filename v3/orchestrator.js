/* GTM World Model v3 - visible multi-agent orchestrator.
   Every agent emits events into the shared stream; the UI renders all of it live. */
(function (root) {
  'use strict';

  function Orchestrator(emit) {
    this.emit = emit;             // emit({agent, kind, text, status})
    this.agents = {};             // id -> {name, status}
    this.findings = {};           // agentId -> result payload
  }
  Orchestrator.prototype.register = function (id, name, note) {
    this.agents[id] = { name: name, status: 'idle', note: note || '' };
    this.emit({ agent: id, kind: 'status', status: 'idle', text: name + ' registered' + (note ? ' - ' + note : '') });
  };
  Orchestrator.prototype.start = function (id, text) {
    this.agents[id].status = 'running';
    this.emit({ agent: id, kind: 'status', status: 'running', text: text || (this.agents[id].name + ' started') });
  };
  Orchestrator.prototype.log = function (id, text) {
    this.emit({ agent: id, kind: 'log', text: text });
  };
  Orchestrator.prototype.done = function (id, text, payload) {
    this.agents[id].status = 'done';
    if (payload !== undefined) this.findings[id] = payload;
    this.emit({ agent: id, kind: 'status', status: 'done', text: text || (this.agents[id].name + ' finished'), payload: payload });
  };
  Orchestrator.prototype.fail = function (id, text) {
    this.agents[id].status = 'error';
    this.emit({ agent: id, kind: 'status', status: 'error', text: text });
  };
  Orchestrator.prototype.pending = function (id, text) {
    this.agents[id].status = 'pending';
    this.emit({ agent: id, kind: 'status', status: 'pending', text: text });
  };

  root.Orchestrator = Orchestrator;
})(typeof self !== 'undefined' ? self : this);
