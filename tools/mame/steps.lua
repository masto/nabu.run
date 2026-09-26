-- Runs timed steps from NABU_STEPS, separated by "|":
--   <seconds>:snap          save a snapshot
--   <seconds>:type:<text>   type text (\n for Enter) on the natural keyboard
--   <seconds>:exit          quit MAME
-- Times are emulated seconds since start.

local steps = {}
for item in string.gmatch(os.getenv("NABU_STEPS") or "", "[^|]+") do
  local t, action, arg = string.match(item, "^([%d.]+):(%a+):?(.*)$")
  table.insert(steps, { t = tonumber(t), action = action, arg = (arg or ""):gsub("\\n", "\n") })
end
table.sort(steps, function(a, b) return a.t < b.t end)

-- Characters are posted one at a time; the keyboard drops them if rushed.
local pending, nextKey = {}, 0

local nextStep = 1
local function tick()
  local now = manager.machine.time:as_double()
  if #pending > 0 and now >= nextKey then
    manager.machine.natkeyboard:post(table.remove(pending, 1))
    nextKey = now + 0.15
  end
  while steps[nextStep] and now >= steps[nextStep].t do
    local s = steps[nextStep]
    nextStep = nextStep + 1
    print(string.format("[steps] %.1f %s %s", now, s.action, s.arg))
    if s.action == "snap" then
      manager.machine.video:snapshot()
    elseif s.action == "type" then
      manager.machine.natkeyboard.in_use = true
      for ch in s.arg:gmatch(".") do table.insert(pending, ch) end
    elseif s.action == "exit" then
      manager.machine:exit()
    end
  end
end

_G.nabu_steps_sub = emu.add_machine_frame_notifier(tick)
