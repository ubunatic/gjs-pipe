# GjsPipe

![GjsPipe Logo](gjspipe.svg)

[GjsPipe](https://github.com/ubunatic/gjs-pipe) provides utilities to safely manage your [Gio.Subprocess](https://gjs-docs.gnome.org/gio20~2.66p/gio.subprocess).


The library provides a [Pipe](lib/gjspipe/pipe.js) class for easily and safely creating
processes in your `gjs` application and consuming the process
output line by line.

## Basic Usage
```js
    // define a process to run a script in your system
    let p = new Pipe('bash', '-c', 'while sleep 1; do echo "looping"; done')

    // start the process and start reading output line by line
    let cancel = p.start(line => print(line))

    // if required, stop the pipe using the cancel function
    cancel()

    // That's all!
```

**WARNING**: Make sure to call `cancel` before exiting your `gjs` app.

An unclean exit of your `gjs` app can create orphaned processes in your system.
Unfortunately `gjs` does not ensure that all instances of `Gio.Subprocess`
are killed automatically on program exit.

## Complete Usage Example
Here is an example how to turn a system program on and off and consume its output.
```js
    const script = 'my-command'
    const p = new Pipe('bash', '-c', script)
    let cancel = null

    function onResult(line) {
        print(line)
    }

    function onExit(ok) {
        if (ok) log(`pipe ${script} stopped`)
        else    logError(new Error(`pipe ${script} failed, see logs for details`))
    }

    function onError(err) {
        logError(err)
        if (cancel) {
            log(`pipe ${script} had errors, stopping pipe...`)
            cancel()
        }
    }

    function startPipe() {
        return p.start(onResult, onExit, onError)
    }

    function toggle() {
        if (cancel) { cancel(); cancel = null }
        else        { cancel = startPipe()    }
    }

    toggleBtn.connect('toggled', (btn) => toggle())
```

The `onExit` and `onError` callbacks are optional.

* Without `onError` any errors will be logged via `logError`.
* Without `onExit` the pipe may exit and fail silently.

## Async Features

In addition to two simple `asyncTimeout` and `makeAsync` functions for running
and awaiting any function asynchronously, this library also provides a
`glibAsync` function to `await` async Glib start and finish calls.

## Async Execution of Gio/GLib Functions

Async [Gio](https://gjs-docs.gnome.org/gio20~2.66p/) and
[Glib](https://gjs-docs.gnome.org/glib20~2.66.1/) functions
usually consist of a `<func>_async` and a `<func>_finish` for calling and handling
async IO. They do not return a `Promise` and thus cannot be awaited.

GjsPipe provides **`glibAsync`** to mitigate this.

Instead of callback-based execution, where errors may get lost in async nirvana:
```js
const ctx = new Gio.Cancellable()
try {
    proc.wait_check_async(ctx, (_, res) => {
        try {
            const ok = proc.wait_check_finish(res)
        } catch (e) {
            // async errors must be handled in the async handler functions
            // and somehow be exposed the start-level using another callback
            handleAsyncError(e)
        }
    }
} catch (e) {
    // only "start" errors can be catched
}
```

You can now use `async` and `await` and have errors thrown to where you started the execution:
```js
try {
    const ctx = new Gio.Cancellable()
    const ok = await glibAsync(
        (finish) => proc.wait_check_async(ctx, finish),  // GLib start logic
        (_, res) => proc.wait_check_finish(res),         // GLib finish logic
    )
} catch (e) {
    // all errors can handled at the start-level of the async function
}
```

## License
MIT