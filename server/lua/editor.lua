local Network = require("selene.network")
local Json = require("selene.json")
local Event = require("selene.event")
local Registries = require("selene.registries")

local Editor = {}
local coordinateLookups = {}
local nextInlineId = 0
local gizmoProviders = {}
local goToProviders = {}
local registryVisualResolvers = {}
local MAX_FILE_BYTES = 60 * 1024
local RUNTIME_DATA_KEY = "moonlight-editor:state"
local INLINE_SESSION_KEY = "moonlight-editor:inline-session"
local stateEvent = Event.of("moonlight-editor:state")

local function sendError(player, message)
    Network.sendToPlayer(player, "moonlight-editor:error", { message = tostring(message) })
end

local function openFile(player, path)
    Network.sendToPlayer(player, "moonlight-editor:resource-path", { path = path })
end

local function isRegistryResource(path, registry)
    local namespace, entry = path:match("^[^/]+/common/data/([^/]+)/[^/]+/(.+)%.json$")
    if not namespace then namespace, entry = path:match("^[^/]+/server/data/([^/]+)/[^/]+/(.+)%.json$") end
    if not namespace then return false end
    local ok, resource = pcall(Registries.findByName, registry, namespace .. ":" .. entry)
    return ok and resource and resource:getSourcePath() == path
end

local function editorState(enabled)
    local visualRegistries = {}
    for registry in pairs(registryVisualResolvers) do table.insert(visualRegistries, registry) end
    return { enabled = enabled, visualRegistries = visualRegistries }
end

local function focusCamera(player, coordinate)
    player:getRuntimeData(RUNTIME_DATA_KEY).coordinate = coordinate
    local controlled = player:getControlledEntity()
    if controlled then
        player:setCameraToFollowControlledEntity()
        player:setCameraToCoordinate(coordinate, controlled:getDimension())
    else
        player:setCameraToCoordinate(coordinate)
    end
end

local function setEnabled(player, enabled)
    player:removeRuntimeData(INLINE_SESSION_KEY)
    local state = player:getRuntimeData(RUNTIME_DATA_KEY)
    state.enabled = enabled
    if enabled then
        if not state.coordinate then
            local controlled = player:getControlledEntity()
            if controlled then
                state.coordinate = controlled:getCoordinate()
            end
        end
        if state.coordinate then
            focusCamera(player, state.coordinate)
        end
    else
        player:setCameraToFollowControlledEntity()
    end
    Network.sendToPlayer(player, "moonlight-editor:editor-state", editorState(enabled))
    stateEvent:fire(player, enabled)
end

function Editor.isEnabled(player)
    return player:hasRuntimeData(RUNTIME_DATA_KEY)
        and player:getRuntimeData(RUNTIME_DATA_KEY).enabled == true
end

function Editor.toggle(player)
    local enabled = not Editor.isEnabled(player)
    setEnabled(player, enabled)
    return enabled
end

Network.handlePayload("moonlight-editor:toggle", function(player)
    Editor.toggle(player)
end)

function Editor.registerCoordinateLookup(lookup)
    assert(type(lookup) == "function", "Coordinate lookup must be a function.")
    table.insert(coordinateLookups, lookup)
end

function Editor.registerGizmoProvider(provider)
    assert(type(provider) == "function", "Gizmo provider must be a function.")
    table.insert(gizmoProviders, provider)
end

---Register a provider returning { name, coordinate = { x, y, z }, visual?, type } targets.
---Providers receive the requesting player and are refreshed whenever the menu opens.
function Editor.registerGoToProvider(provider)
    assert(type(provider) == "function", "GoTo provider must be a function.")
    table.insert(goToProviders, provider)
end

Network.handlePayload("moonlight-editor:request-go-to-targets", function(player)
    if not Editor.isEnabled(player) then return end
    local targets = {}
    for _, provider in ipairs(goToProviders) do
        local ok, provided = pcall(provider, player)
        if not ok then
            sendError(player, provided)
        elseif type(provided) == "table" then
            for _, target in ipairs(provided) do
                local coordinate = target.coordinate
                local valid = type(coordinate) == "table"
                for _, axis in ipairs({ "x", "y", "z" }) do
                    local value = valid and coordinate[axis]
                    if type(value) ~= "number" or value % 1 ~= 0 or math.abs(value) > 2147483647 then
                        valid = false
                    end
                end
                if valid and type(target.name) == "string" and type(target.type) == "string" then
                    table.insert(targets, {
                        name = target.name, type = target.type,
                        coordinate = { x = coordinate.x, y = coordinate.y, z = coordinate.z },
                        visual = type(target.visual) == "string" and target.visual or nil,
                    })
                end
            end
        end
    end
    table.sort(targets, function(a, b)
        if a.name == b.name then return a.type < b.type end
        return a.name < b.name
    end)
    Network.sendToPlayer(player, "moonlight-editor:go-to-targets-start", {})
    for first = 1, #targets, 100 do
        local chunk = {}
        for index = first, math.min(first + 99, #targets) do table.insert(chunk, targets[index]) end
        Network.sendToPlayer(player, "moonlight-editor:go-to-targets", { targets = chunk })
    end
    Network.sendToPlayer(player, "moonlight-editor:go-to-targets-end", {})
end)

function Editor.registerRegistryVisualResolver(registryName, resolver)
    assert(type(registryName) == "string" and registryName ~= "", "Registry name must be a non-empty string.")
    assert(type(resolver) == "function", "Registry visual resolver must be a function.")
    registryVisualResolvers[registryName] = resolver
end

Network.handlePayload("moonlight-editor:resolve-registry-visuals", function(player, payload)
    if not Editor.isEnabled(player) or type(payload) ~= "table"
        or type(payload.registry) ~= "string" or type(payload.values) ~= "table" then return end
    local resolver = registryVisualResolvers[payload.registry]
    if not resolver then return end
    local visuals = {}
    for index, value in ipairs(payload.values) do
        if index > 50 then break end
        if type(value) == "string" then
            local ok, visual = pcall(function()
                local entry = Registries.findByName(payload.registry, value)
                return entry and resolver(entry)
            end)
            if ok and type(visual) == "string" then visuals[value] = visual end
        end
    end
    Network.sendToPlayer(player, "moonlight-editor:registry-visuals", { registry = payload.registry, visuals = visuals })
end)

Network.handlePayload("moonlight-editor:request-gizmos", function(player, payload)
    if not Editor.isEnabled(player) or type(payload) ~= "table" then return end
    local x, y, z = payload.x, payload.y, payload.z
    if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number"
        or x % 1 ~= 0 or y % 1 ~= 0 or z % 1 ~= 0
        or math.abs(x) > 2147483647 or math.abs(y) > 2147483647 or math.abs(z) > 2147483647 then
        return
    end
    local coordinate = position(x, y, z)
    local gizmos = {}
    for _, provider in ipairs(gizmoProviders) do
        local ok, provided = pcall(provider, player, coordinate)
        if ok and type(provided) == "table" then
            for _, gizmo in ipairs(provided) do
                local coordinate = gizmo.coordinate
                if type(gizmo.id) == "string" and type(coordinate) == "table"
                    and type(coordinate.x) == "number" and type(coordinate.y) == "number"
                    and type(coordinate.z) == "number" then
                    table.insert(gizmos, {
                        id = gizmo.id,
                        label = type(gizmo.label) == "string" and gizmo.label or gizmo.id,
                        coordinate = { x = coordinate.x, y = coordinate.y, z = coordinate.z },
                        lookup = gizmo.lookup == true,
                        path = type(gizmo.path) == "string" and gizmo.path or nil,
                        color = type(gizmo.color) == "string" and gizmo.color or nil,
                        visual = type(gizmo.visual) == "string" and gizmo.visual or nil,
                    })
                end
            end
        end
    end
    Network.sendToPlayer(player, "moonlight-editor:gizmos-start", { count = #gizmos })
    for first = 1, #gizmos, 100 do
        local chunk = {}
        for index = first, math.min(first + 99, #gizmos) do
            table.insert(chunk, gizmos[index])
        end
        Network.sendToPlayer(player, "moonlight-editor:gizmos", { gizmos = chunk })
    end
    Network.sendToPlayer(player, "moonlight-editor:gizmos-end", {})
end)

Network.handlePayload("moonlight-editor:lookup-coordinate", function(player, payload)
    if not Editor.isEnabled(player) or type(payload) ~= "table" then return end
    if type(payload.x) ~= "number" or type(payload.y) ~= "number" or type(payload.z) ~= "number"
        or payload.x % 1 ~= 0 or payload.y % 1 ~= 0 or payload.z % 1 ~= 0 then return end
    if payload.scope ~= nil and type(payload.scope) ~= "string" then return end
    local coordinate = position(payload.x, payload.y, payload.z)
    for _, lookup in ipairs(coordinateLookups) do
        local ok, path = pcall(lookup, coordinate, payload.scope, player)
        if not ok then
            sendError(player, path)
            return
        end
        if ok and type(path) == "table" and payload.scope == nil then
            if type(path.schema) == "table" and type(path.values) == "table" and type(path.update) == "function" then
                nextInlineId = nextInlineId + 1
                player:overwriteRuntimeData(INLINE_SESSION_KEY, { id = nextInlineId, update = path.update })
                Network.sendToPlayer(player, "moonlight-editor:inline-form", {
                    id = nextInlineId, title = path.title or "Edit coordinate", schema = path.schema,
                    fieldLabels = path.fieldLabels,
                    contents = Json.encode(path.values), coordinate = { x = payload.x, y = payload.y, z = payload.z },
                })
                return
            end
        end
        if ok and type(path) == "string" then
            if payload.scope == nil or isRegistryResource(path, payload.scope) then
                local opened, message = pcall(openFile, player, path)
                if not opened then sendError(player, message) end
                return
            end
        end
    end
end)

Network.handlePayload("moonlight-editor:close-inline-form", function(player, payload)
    local session = player:hasRuntimeData(INLINE_SESSION_KEY) and player:getRuntimeData(INLINE_SESSION_KEY)
    if session and type(payload) == "table" and payload.id == session.id then player:removeRuntimeData(INLINE_SESSION_KEY) end
end)

Network.handlePayload("moonlight-editor:save-inline-form", function(player, payload)
    if type(payload) ~= "table" or type(payload.id) ~= "number" then return end
    local session = player:hasRuntimeData(INLINE_SESSION_KEY) and player:getRuntimeData(INLINE_SESSION_KEY)
    if not Editor.isEnabled(player) or not session or payload.id ~= session.id then
        Network.sendToPlayer(player, "moonlight-editor:inline-form-saved", {
            id = payload.id, success = false, message = "This form has expired. Close it and click the coordinate again.",
        })
        return
    end
    local ok, message = pcall(function()
        assert(type(payload.contents) == "string", "Form contents must be JSON.")
        assert(#payload.contents <= MAX_FILE_BYTES, "Form is too large.")
        local values = Json.decode(payload.contents)
        assert(type(values) == "table", "Form values must be an object.")
        session.update(values, player)
    end)
    Network.sendToPlayer(player, "moonlight-editor:inline-form-saved", {
        id = session.id, success = ok, message = ok and "Changes applied" or tostring(message),
    })
end)

Network.handlePayload("moonlight-editor:move-camera", function(player, payload)
    if not Editor.isEnabled(player) or type(payload) ~= "table" then
        return
    end
    local x, y, z = payload.x, payload.y, payload.z
    if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number"
        or x % 1 ~= 0 or y % 1 ~= 0 or z % 1 ~= 0
        or math.abs(x) > 2147483647 or math.abs(y) > 2147483647 or math.abs(z) > 2147483647 then
        return
    end
    local coordinate = position(x, y, z)
    player:getRuntimeData(RUNTIME_DATA_KEY).coordinate = coordinate
    player:setCameraToCoordinate(coordinate)
end)

Network.handlePayload("moonlight-editor:go-to", function(player, payload)
    if not Editor.isEnabled(player) or type(payload) ~= "table" then return end
    for _, axis in ipairs({ "x", "y", "z" }) do
        local value = payload[axis]
        if type(value) ~= "number" or value % 1 ~= 0 or math.abs(value) > 2147483647 then return end
    end
    focusCamera(player, position(payload.x, payload.y, payload.z))
end)

Network.handlePayload("moonlight-editor:focus-character", function(player)
    if not Editor.isEnabled(player) then return end
    local controlled = player:getControlledEntity()
    if not controlled then return end
    local coordinate = controlled:getCoordinate()
    focusCamera(player, coordinate)
end)

Network.handlePayload("moonlight-editor:request-state", function(player)
    local enabled = Editor.isEnabled(player)
    Network.sendToPlayer(player, "moonlight-editor:editor-state", editorState(enabled))
    stateEvent:fire(player, enabled)
end)

return Editor
