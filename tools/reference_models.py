"""Independent standard-library mathematical reference for synthetic test fixtures."""
import math

PRIOR = 5.0
HAZARD = 1/30
ETA = 2.0
SHARE = .04
EXPERTS = ['fair50', 'beta10', 'beta30', 'markov30', 'bocpd']

def beta(history, window):
    sample = history[-window:]
    return (PRIOR + sum(sample))/(2*PRIOR + len(sample))

def markov(history):
    if not history:
        return .5
    sample = history[-30:]
    pairs = [(a,b) for a,b in zip(sample, sample[1:]) if a == history[-1]]
    return (PRIOR + sum(b for _,b in pairs))/(2*PRIOR + len(pairs))

class BOCPD:
    def __init__(self):
        self.q = [1.0]
        self.history = []

    def component_means(self):
        wins = 0
        means = [.5]
        for k, y in enumerate(reversed(self.history), 1):
            wins += y
            means.append((PRIOR+wins)/(2*PRIOR+k))
        return means

    def predict(self):
        return HAZARD*.5 + (1-HAZARD)*sum(q*p for q,p in zip(self.q, self.component_means()))

    def update(self, y):
        new = [0.0]*(len(self.q)+1)
        new[1] = HAZARD*.5
        for k, (q,p) in enumerate(zip(self.q, self.component_means())):
            new[k+1] += (1-HAZARD)*q*(p if y else 1-p)
        total = sum(new)
        self.q = [q/total for q in new]
        self.history.append(y)
        assert abs(sum(self.q)-1) < 1e-12

class Replay:
    def __init__(self):
        self.history = []
        self.cp = BOCPD()
        self.hedge = [1/len(EXPERTS)]*len(EXPERTS)
        self.fixed = self.hedge.copy()

    def predict(self):
        base = [.5, beta(self.history,10), beta(self.history,30), markov(self.history), self.cp.predict()]
        return dict(zip(EXPERTS,base)) | {
            'hedge': sum(w*p for w,p in zip(self.hedge,base)),
            'fixedShare': sum(w*p for w,p in zip(self.fixed,base)),
        }

    def update(self, y, predictions):
        loss = [(predictions[name]-y)**2 for name in EXPERTS]
        def update_weights(weights, gamma):
            raw = [w*math.exp(-ETA*l) for w,l in zip(weights,loss)]
            normalizer = sum(raw)
            return [(1-gamma)*w/normalizer+gamma/len(EXPERTS) for w in raw]
        self.hedge = update_weights(self.hedge,0)
        self.fixed = update_weights(self.fixed,SHARE)
        self.cp.update(y)
        self.history.append(y)

def replay(labels):
    engine, rows = Replay(), []
    for index,y in enumerate(labels,1):
        predictions = engine.predict()  # strictly before revealing y
        assert all(math.isfinite(p) and 0 <= p <= 1 for p in predictions.values())
        rows.append({'sequence': index, 'outcome': y, 'predictions': predictions})
        engine.update(y,predictions)
    scores = {}
    for name in engine.predict():
        probs = [row['predictions'][name] for row in rows]
        brier = sum((p-y)**2 for p,y in zip(probs,labels))/len(labels)
        logloss = -sum(y*math.log(max(1e-12,p))+(1-y)*math.log(max(1e-12,1-p)) for p,y in zip(probs,labels))/len(labels)
        scores[name] = {'brier': brier, 'logLoss': logloss, 'brierSkillVs50': 1-brier/.25}
    return {'n': len(labels), 'scores': scores, 'nextPrediction': engine.predict(), 'rows': rows}
