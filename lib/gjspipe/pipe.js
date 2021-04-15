gi = imports.gi
const { Gio, GLib, GObject } = gi

const SIGTERM = 15  // can be ignored
const SIGKILL = 9   // cannot be ignored

const GioError = (status) => {
    return new Gio.IOErrorEnum({
        code: Gio.io_error_from_errno(status),
        message: GLib.strerror(status),
    })
}

const isCancelled = (err) => (
    err instanceof Gio.IOErrorEnum &&
    err.code == Gio.IOErrorEnum.CANCELLED
)

const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE
})

function readLine(ctx, stdout, onLine, onFinished) {
    stdout.read_line_async(GLib.PRIORITY_LOW, ctx, (_, res) => {
        try {
            let line = stdout.read_line_finish_utf8(res)[0]
            if (line == null) return onFinished()
            onLine(line)
            readLine(ctx, stdout, onLine, onFinished)
        } catch (e) {
            if (isCancelled(e)) onFinished()
            else                onFinished(e)
        }
    })
}

var clearTimeout = GLib.source_remove
var setTimeout = (func, delay_ms, ...args) => {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay_ms, () => {
        func(...args)
        return GLib.SOURCE_REMOVE
    })
}

var AGG_LINES = 'AGG_LINES'
var AGG_JSON  = 'AGG_JSON'

/**
 * Pipe is a user-friendly and safe command runner.
 */
var Pipe = class Pipe {
    /**
     * Create a new Pipe.
     * @param  {...string} cmd  - the command to run
     * 
     * @example
     * // start a loop in `bash`
     * let p = new Pipe('bash', '-c', 'while sleep 1; do echo "looping"; done')
     * let cancel = p.start(onResult, onExit)
     * // ... some time later ...
     * cancel()  // You must call cancel later to avoid zombies!
     * 
     * @example
     * // start a simple command and read all output
     * let p = new Pipe('bash', '-c', 'echo 1')
     * p.start((l) => print(l), (ok) => print(ok? 'OK':'ERR'))
     * 
     */
    constructor(...cmd) {
        this.command_line = cmd.join(' ')
        this.args = cmd.slice(1)
        this.cmd  = cmd[0]
        this.line = ''
        this.err = null
        this.history = []
        this._cancel = null
        this.configure({})
    }
    /**
     * Overrides all pipe parameters with defaults or given values
     */
    configure({read_timeout_ms=0, aggregation_func=null, agg_type=null, verbose=false, keep=100}={}) {
        /**
         * Defines how many lines to keep in history
         */
        this.keep = keep

        /** 
         * line aggregation function to produce aggregated results
         * 
         * Default: `null` (no aggregation)
        */
        this.aggregation = aggregation_func
        switch (agg_type) {
            case AGG_JSON:  this.aggregation = this.aggregateJSON; break
            case AGG_LINES: this.aggregation = this.aggregateLines; break
        }

        /** set to `true` to show more logs */
        this.verbose = verbose

        /**
         `read_timeout_ms` defines how long to wait for pending output after process termination.
 
         Values
            - `true`   - will read all buffered lines but may slow down pipe termination
            - `false`  - skips pending output on exit and thus facilitates fast termination
         
         Default: `false`
         */
        this.read_timeout_ms = read_timeout_ms
        return this
    }
    log(msg) {
        if (this.verbose) log(msg)
    }
    /** collects a line history */
    aggregateLines(line) {
        const agg = this.history
        agg.push(line)
        if (agg.length >= this.keep * 2) {
            this.history = agg.slice(-this.keep)
            return this.history.slice(0)
        }
    }
    /** aggregates multi-line output from formatted JSON objects */
    aggregateJSON(line) {
        const agg = this.history
        if(line.match(/^},?$/)) {
            // Found a closing bracket at the root level which should close the
            // last root-level JSON object.
            // Note: This kind of data is sent by `intel_gpu_top -J`
            try {
                let data = JSON.parse(agg.join('\n') + '\n}')
                this.history = []
                return data
            } catch (e) {
                this.log(`ignoring multi-line JSON parse error: ${e.message}`)
            }
        }
        agg.push(line)
        if (agg.length > 1e6) {
            this.err = new Error('aggregation buffer exceeds 1M lines')
            this.stop()
        }
    }
    stop() {
        if (this._cancel) {
            // stealing the cancel method to stop reading and exit the process
            this._cancel()
        }
        this.history = []
        this.err = null
        this.line = ''
    }
    start(onResult=null, onExit=null) {
        this.stop()  // ensure we run not more than once

        let proc = null
        let ctx  = null

        // start the process and connect the stdout stream
        const spawn = () => {
            proc = launcher.spawnv([this.cmd, ...this.args])           
            let stdout = new Gio.DataInputStream({
                base_stream: proc.get_stdout_pipe(),
                close_base_stream: true
            })
            ctx = new Gio.Cancellable()
            this.log(`starting pipe ${this.command_line}`)
            readLine(ctx, stdout, read, finish)
        }

        // wait for process termination and check exit status
        const finish = (pipe_error=null) => {
            this.log(`terminating pipe ${this.command_line} termination_requested=${termination_requested}`)
            proc.wait_check_async(null, (_, res) => {
                let proc_error = null
                let ok = true
                try         { ok = proc.wait_check_finish(res) }
                catch (err) { proc_error = err }
                if (pipe_error) logError(pipe_error)
                if (termination_requested) {
                    // context was cancelled by the user, unclean exit is expected
                    ok = ok && pipe_error == null? true : false
                } else {
                    // context was not cancelled manually, unclean exit not expected
                    if (proc_error) logError(proc_error)
                    ok = ok && pipe_error == null && proc_error == null ? true : false
                }
                if (ok) this.log(`pipe finished '${this.command_line}'`)
                else    this.log(`pipe failed '${this.command_line}'`)
                onExit(ok)
            })
        }

        // read single line and forward potential results
        const read = (line) => {
            let result = this.line = line
            if (this.aggregation) result = this.aggregation(line)
            if (result != null && onResult) onResult(result)
        }

        let terminated = false
        let termination_requested = false
        // allow internal and external cancellation
        let cancel = this._cancel = () => {
            if (terminated) return
            terminated = true            
            if (!ctx.is_cancelled()) {
                termination_requested = true                
            }
            ctx.cancel()
            proc.force_exit()
        }

        // start the process, catch and handle sync errors
        try       { spawn() }
        catch (e) { cancel(); throw e }

        return cancel
    }
}

if (!this.module) this.module = {}
module.exports = { Pipe, AGG_LINES, AGG_JSON, setTimeout, clearTimeout }
